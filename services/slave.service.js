"use strict";
const axios = require("axios");
const Shell = require('node-powershell');
const Cron = require("moleculer-cron");

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */
module.exports = {
	name: "slaveService",

	/**
	 * Settings
	 */
	settings: {
    host: process.env.HOST,
    user: process.env.USER,
    pass: process.env.PASSWORD,
		ipmitoolTemplates: {
			enableFanSpeedControl: "raw 0x30 0x30 0x01 0x00",
			disableFanSpeedControl: "raw 0x30 0x30 0x01 0x01",
			setFanSpeedControl: "raw 0x30 0x30 0x02 0xff",
			directory: "C:\\Program Files (x86)\\Dell\\SysMgt\\bmc"
		},
		fanSpeedOfset: 15
	},
	mixins: [Cron],
	/**
	 * Dependencies
	 */
	dependencies: [],
	crons: [{
		name: "slaveServiceCronJob",
		cronTime: "0/2 * * * * *",
		onTick: function () {
		  this.getLocalService("slaveService")
			.actions.runCronjob()
			.then(() => {
			  //this.logger.info("slaveServiceCronJob run at ", moment().format("YYYY-MM-DD HH:mm:ss"));
			});
		},
		runOnInit: function () {
		},
		manualStart: false,
		timeZone: "Asia/Ho_Chi_Minh"
	  }],

	/**
	 * Actions
	 */
	actions: {
        getCPUTemperature: {
            async handler(ctx) {
                return await this.getCPUTemperature(ctx.params);
            }
        },
		setFan: {
			async handler(ctx) {
				return await this.setFan(ctx.params.speed);
			}
		},
		returnDefaultSpeedFan: {
			async handler(ctx) {
				return await this.returnDefaultSpeedFan();
			}
		},
		fanOperate: {
			async handler(ctx) {
				return await this.fanOperate();
			}
		},
		runCronjob: {
			async handler() {
				return await this.fanOperate();
			}
		},
		startFanJob: {
			async handler() {
				this.isHealthy = true;
				return await this.startFanJob();
			}
		},
		stopFanJob: {
			async handler() {
				return await this.stopFanJob();
			}
		}
	},

	/**
	 * Methods
	 */
	methods: {
        async getCPUTemperature() {
			let result = { status: false, msg: "" };
			try {
				let res = await axios.get(`http://${process.env.HOST_RUN_SLAVE_SERVICE}:8085/data.json`);
				if (!res || Number(res.status) !== 200 || !res.data) throw Error("Cannot get CPU temperature");
				// Build cores object
				let cpus = res.data.Children[0].Children;
				let cores = [];
				for (const i in cpus) {
					let cpu = cpus[i].Children
					for (const j in cpu) {
						if (cpu[j].Text == "Temperatures") {
							for (const k in cpu[j].Children) {
								const core = cpu[j].Children[k];
								cores.push(core);
							}
						}
					}
				}
				// set max of CPU temperature
				if (!cpus || !cpus.length) throw Error("Cannot get temperature of each CPU core");
				let maxTemperature = 0;
				for (const i in cores) {
					const core = cores[i];
					core.Value = Number(core.Value.replace(" °C",""));
					if (isNaN(core.Value)) throw Error(`Temperature of ${core.Text} is error`);
					if (core.Value > maxTemperature) maxTemperature = core.Value;
				}
				maxTemperature = Math.round(maxTemperature);
				if (isNaN(maxTemperature)) throw Error("Cannot get the max temperature");
				result.temperature = maxTemperature;
				result.isHealthy = this.isHealthy;
				result.status = true;
			} catch (e) {
				this.isHealthy = false;
				result.msg = e.message;
			}
			this.logger.info(result);
			return result;
        },
		async setFan(speed){
			let result = { status: false, msg: "" };
			const ps = new Shell({
				executionPolicy: 'Bypass',
				noProfile: true
			});
			let checkPoint = setTimeout(() => {
				this.isHealthy = false;
			}, 2000);
			try {
				if (!speed || isNaN(speed) || Number(speed) < 20 || Number(speed) > 100) throw Error("Speed is invalid, speed must be a number between 20 and 100");
				const hexValue = speed.toString(16);
				ps.addCommand(`cd \"${this.settings.ipmitoolTemplates.directory}\"`);
				await ps.invoke()
				.then(() => {
					ps.addCommand(`./ipmitool.exe -I lanplus -H ${this.settings.host} -U ${this.settings.user} -P ${this.settings.pass} ${this.settings.ipmitoolTemplates.enableFanSpeedControl}`);
					return ps.invoke();
				})
				.then(() => {
					ps.addCommand(`./ipmitool.exe -I lanplus -H ${this.settings.host} -U ${this.settings.user} -P ${this.settings.pass} ${this.settings.ipmitoolTemplates.setFanSpeedControl} 0x${hexValue}`);
					return ps.invoke();
				})
				.then(() => {
					clearTimeout(checkPoint);
					result.msg = `The speed of fan has been set to ${speed}%`;
					result.status = true;
				}).catch(err => {throw err});
			} catch (e) {
				this.isHealthy = false;
				result.msg = e.message;
			}
			ps.dispose();
			this.logger.info("=====setFan=====>",result);
			return result;
		},
		async returnDefaultSpeedFan() {
			let result = { status: false, msg: "" };
			const ps = new Shell({
				executionPolicy: 'Bypass',
				noProfile: true
			});
			try {
				ps.addCommand(`cd \"${this.settings.ipmitoolTemplates.directory}\"`);
				await ps.invoke().then(async () => {
					ps.addCommand(`./ipmitool.exe -I lanplus -H ${this.settings.host} -U ${this.settings.user} -P ${this.settings.pass} ${this.settings.ipmitoolTemplates.disableFanSpeedControl}`);
					return ps.invoke();
				}).then(async () => {
					result.msg = "Fan has been set to default speed";
					result.status = true;
				}).catch(err => {throw err});
			} catch (e) {
				this.isHealthy = false;
				result.msg = e.message;
			}
			ps.dispose();
			this.logger.info(result);
			return result;
		},
		async fanOperate() {
			let result = { status: false, msg: "" };
			try {
				if (!this.isHealthy) {
					this.logger.info(this.stopFanJob());
					throw Error("This node is not healthy, stop job and wait for checker set normal");
				}
				const cpu = await this.getCPUTemperature();
				if (!cpu.status || !cpu.temperature) throw Error(`Operate failed ${cpu.msg?", "+cpu.msg:", cannot get CPU temperature"}`);
				if (cpu.temperature > 20 && cpu.temperature < 70) {
					const setFanResult = await this.setFan(Number(cpu.temperature) - Number(this.settings.fanSpeedOfset));
					this.logger.info("====================>",setFanResult);
					if (!setFanResult.status) throw Error(`Operate failed ${setFanResult.msg?", "+setFanResult.msg:", cannot set fan speed"}`);
					result.msg = `CPU Temp: ${cpu.temperature} - ${setFanResult.msg}`;
					this.logger.info(result.msg);
					this.isHealthy = true;
					result.status = true;
				} else if (cpu.temperature > 70) {
					await this.returnDefaultSpeedFan();	
				}
			} catch (e) {
				this.isHealthy = false;
				result.msg = e.message;
				let rs = await this.returnDefaultSpeedFan();
				if (rs) result.msg += rs.msg;
			}
			this.logger.info(result);
			this.logger.info("=================================================================================");
			return result;
		},
		startFanJob() {
			let job = this.getJob("slaveServiceCronJob");
			if (job) {
				job.start();
				return true;
			}
			return false;
		},
		stopFanJob() {
			let job = this.getJob("slaveServiceCronJob");
			if (job) {
				job.stop();
				return true;
			}
			return false;
		}
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {
		this.isHealthy = true;
		this.cronStatus = false;
	},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {
	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {
		this.returnDefaultSpeedFan();
	}
};
// *  *  *  *  *  *
// ┬  ┬  ┬  ┬  ┬  ┬
// │  │  │  │  │  └─────────────── day of week (0 - 7) (0 and 7 - represents Sunday)
// │  │  │  │  └────────────────── month (1 - 12)
// │  │  │  └───────────────────── day of month (1 - 31)
// │  │  └──────────────────────── hour (0 - 23)
// │  └─────────────────────────── minute (0 - 59)
// └────────────────────────────── second (0 - 59)

// * * * * * * - every second
// 0 * * * * * - every minute
// 0 0 * * * * - every hour
// 0 0 0 * * * - every day
// 0 0 0 * * 1 - every monday
// 0 1-2 * * * - every first and second minutes of hour
// 0 0 1,2 * * - every first and second hours of day
// 0 0 0-12/2 * * - every second hour of day first half

// also you can use synonyms:
// * @yearly   - 0 0 0 1 1 *
// * @annually - 0 0 0 1 1 *
// * @monthly  - 0 0 0 1 * *
// * @weekly   - 0 0 0 * * 0
// * @daily    - 0 0 0 * * *
// * @hourly   - 0 0 * * * *