"use strict";
const Shell = require('node-powershell');
const Cron = require("moleculer-cron");

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "checkService",
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
			setFanSpeedControl: "raw 0x30 0x30 0x02 0xff",
			directory: "C:\\Program Files (x86)\\Dell\\SysMgt\\bmc"
    },
    fanSpeedOfset: 15
	},
  crons: [{
		name: "checkServiceCronJob",
		cronTime: "0/5 * * * * *",
		onTick: function () {
		  this.getLocalService("checkService")
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
    getNodeCpuTemperature: {
      async handler(ctx) {
        return await this.getNodeCpuTemperature();
      }
    },
    setNodeDefaultSpeedFan: {
      async handler(ctx) {
        return await this.setNodeDefaultSpeedFan();
      }
    },
    fanOperateNode: {
      async handler(ctx) {
        return await this.fanOperateNode();
      }
    },
    setNodeFanSpeed: {
      async handler(ctx) {
        return await this.setNodeFanSpeed(ctx.params.speed);
      }
    },
    runCronjob: {
			async handler() {
				return await this.fanOperateNode();
			}
		},
	},

	/**
	 * Methods
	 */
	methods: {
    async getNodeCpuTemperature() {
      return await this.broker.call("fanService.getCPUTemperature", {
        timeout: 1000
      });
    },
    async setNodeDefaultSpeedFan() {
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
				result.msg = e.message;
			}
			ps.dispose();
			this.logger.info(result);
			return result;
    },
    async setNodeFanSpeed(speed){
			let result = { status: false, msg: "" };
			const ps = new Shell({
				executionPolicy: 'Bypass',
				noProfile: true
			});
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
					result.msg = `The speed of fan has been set to ${speed}%`;
					result.status = true;
				}).catch(err => {throw err});
			} catch (e) {
				result.msg = e.message;
			}
			ps.dispose();
			return result;
    },
    async fanOperateNode() {
			let result = { status: false, msg: "" };
			try {
				const node = await this.getNodeCpuTemperature();
				if (!node.status || !node.temperature) throw Error(`Operate failed ${node.msg?", "+node.msg:", cannot get CPU temperature"}`);
				if (node.temperature < 50) await this.broker.call("fanService.startFanJob");
        if (node.isHealthy) {
          result.msg = `Node is healthy with cpu temp: ${node.temperature}, bypass operate`;
          result.status = true;
          return result;
				}
        this.logger.debug("Node is not stable, Checker will take control for speed fan")
				if (node.temperature > 20 && node.temperature < 70) {
					const setFanResult = await this.setNodeFanSpeed(Number(node.temperature) - Number(this.settings.fanSpeedOfset));
					if (!setFanResult.status) throw Error(`Operate failed ${setFanResult.msg?", "+setFanResult.msg:", cannot set fan speed"}`);
					result.msg = `CPU Temp: ${node.temperature} - ${setFanResult.msg}`;
					this.logger.info(result.msg);
					result.status = true;
				} else if (node.temperature > 70) {
					await this.setNodeDefaultSpeedFan();	
				}
			} catch (e) {
				result.msg = e.message;
				let rs = await this.setNodeDefaultSpeedFan();
				if (rs) result.msg += rs.msg;
			}
			return result;
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
