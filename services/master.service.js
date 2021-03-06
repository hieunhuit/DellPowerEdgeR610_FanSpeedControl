"use strict";
const Cron = require("moleculer-cron");
const { exec } = require('child_process');

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "masterService",
  mixins: [Cron],
	/**
	 * Settings
	 */
	settings: {
    host: "192.168.1.189",
    user: "root",
    pass: "calvin",
    ipmitoolTemplates: {
      enableFanSpeedControl: "raw 0x30 0x30 0x01 0x00",
			disableFanSpeedControl: "raw 0x30 0x30 0x01 0x01",
			setFanSpeedControl: "raw 0x30 0x30 0x02 0xff"
    },
    fanSpeedOfset: 15
	},
  crons: [{
		name: "masterServiceCronJob",
		cronTime: "0/5 * * * * *",
		onTick: function () {
		  this.getLocalService("masterService")
			.actions.runCronjob()
			.then(() => {
			  // this.logger.info("fanSpeedCronJob run at ", moment().format("YYYY-MM-DD HH:mm:ss"));
			});
		},
		runOnInit: function () {
		},
		manualStart: false,
		timeZone: "Asia/Ho_Chi_Minh"
	  }],
	/**
	 * Dependencies
	 */
	dependencies: [],

	/**
	 * Actions
	 */
	actions: {
    getSlaveCpuTemperature: {
      async handler(ctx) {
        return await this.getSlaveCpuTemperature();
      }
    },
    setSlaveDefaultSpeedFan: {
      async handler(ctx) {
        return await this.setSlaveDefaultSpeedFan();
      }
    },
    fanOperateSlave: {
      async handler(ctx) {
        return await this.fanOperateSlave();
      }
    },
    setSlaveFanSpeed: {
      async handler(ctx) {
        return await this.setSlaveFanSpeed(ctx.params.speed);
      }
    },
    runCronjob: {
			async handler() {
				return await this.fanOperateSlave();
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
    async getSlaveCpuTemperature() {
      return await this.broker.call("slaveService.getCPUTemperature");
    },
    async setSlaveDefaultSpeedFan() {
      let result = { status: false, msg: "" };
			try {
				exec(`ipmitool -I lanplus -H ${this.settings.host} -U ${this.settings.user} -P ${this.settings.pass} ${this.settings.ipmitoolTemplates.disableFanSpeedControl}`, (error) => {
					if (error) throw error;
					result.msg = "Fan has been set to default speed";
					result.status = true;
				})
			} catch (e) {
				result.msg = e.message;
			}
			this.logger.info(result);
			return result;
    },
    async setSlaveFanSpeed(speed){
			let result = { status: false, msg: "" };
			try {
				if (!speed || isNaN(speed) || Number(speed) < 20 || Number(speed) > 100) throw Error("Speed is invalid, speed must be a number between 20 and 100");
				const hexValue = Number(speed).toString(16);
				exec(`ipmitool -I lanplus -H ${this.settings.host} -U ${this.settings.user} -P ${this.settings.pass} ${this.settings.ipmitoolTemplates.enableFanSpeedControl}`, (err1) => {
					if (err1) throw err1;
					exec(`ipmitool -I lanplus -H ${this.settings.host} -U ${this.settings.user} -P ${this.settings.pass} ${this.settings.ipmitoolTemplates.setFanSpeedControl} 0x${hexValue}`, (err2) => {
						if (err2) throw err2;
						result.msg = `The speed of fan has been set to ${speed}%`;
						result.status = true;
					})
				})
			} catch (e) {
				result.msg = e.message;
			}
			return result;
    },
    async fanOperateSlave() {
			let result = { status: false, msg: "" };
			try {
				const slave = await this.getSlaveCpuTemperature();
				if (!slave.status || !slave.temperature) throw Error(`Operate failed ${slave.msg?", "+slave.msg:", cannot get CPU temperature"}`);
				if (slave.temperature < 50) await this.broker.call("slaveService.startFanJob");
        if (slave.isHealthy) {
          result.msg = `Slave is healthy with cpu temp: ${slave.temperature}, bypass operate`;
          result.status = true;
          return result;
				}
        this.logger.debug("Slave is not stable, Master will take control for speed fan")
				if (slave.temperature > 20 && slave.temperature < 70) {
					const setFanResult = await this.setSlaveFanSpeed(Number(slave.temperature) - Number(this.settings.fanSpeedOfset));
					if (!setFanResult.status) throw Error(`Operate failed ${setFanResult.msg?", "+setFanResult.msg:", cannot set fan speed"}`);
					result.msg = `CPU Temp: ${slave.temperature} - ${setFanResult.msg}`;
					this.logger.info(result.msg);
					result.status = true;
				} else if (slave.temperature > 70) {
					await this.setSlaveDefaultSpeedFan();	
				}
			} catch (e) {
				result.msg = e.message;
				let rs = await this.setSlaveDefaultSpeedFan();
				if (rs) result.msg += rs.msg;
			}
			return result;
		},
		startFanJob() {
			let job = this.getJob("masterServiceCronJob");
			if (job) {
				job.start();
				return true;
			}
			return false;
		},
		stopFanJob() {
			let job = this.getJob("masterServiceCronJob");
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

	}
};
// *  *  *  *  *  *
// ???  ???  ???  ???  ???  ???
// ???  ???  ???  ???  ???  ???????????????????????????????????????????????? day of week (0 - 7) (0 and 7 - represents Sunday)
// ???  ???  ???  ???  ????????????????????????????????????????????????????????? month (1 - 12)
// ???  ???  ???  ?????????????????????????????????????????????????????????????????? day of month (1 - 31)
// ???  ???  ??????????????????????????????????????????????????????????????????????????? hour (0 - 23)
// ???  ???????????????????????????????????????????????????????????????????????????????????? minute (0 - 59)
// ????????????????????????????????????????????????????????????????????????????????????????????? second (0 - 59)

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