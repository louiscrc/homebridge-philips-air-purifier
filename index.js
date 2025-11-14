const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const execPromise = util.promisify(exec);

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory(
    'homebridge-philips-air-purifier',
    'PhilipsAirPurifier',
    PhilipsAirPurifierAccessory
  );
};

class PhilipsAirPurifierAccessory {
  constructor(log, config) {
    this.log = log;
    this.name = config.name || 'Air Purifier';
    this.host = config.host;
    this.pollInterval = config.pollInterval || 10000;

    if (!this.host) {
      throw new Error('host is required in config');
    }

    const pluginDir = __dirname;

    this.apiScriptPath = config.apiScriptPath || path.join(pluginDir, 'philips_air_api.py');
    this.pythonPath = config.pythonPath || this.findPython(pluginDir);

    if (!fs.existsSync(this.apiScriptPath)) {
      throw new Error(`Python API script not found at: ${this.apiScriptPath}`);
    }

    this.log.info(`Using Python: ${this.pythonPath}`);
    this.log.info(`Using API script: ${this.apiScriptPath}`);

    this.state = {
      power: false,
      mode: 'auto',
      lightLevel: 0,
      pm25: 0,
      iaql: 0,
    };

    this.lastLightLevel = 0;
    this.pollTimer = null;
    this.pendingTimeouts = [];
    this.isUpdating = false;

    this.setupServices();
    this.startPolling();
  }

  findPython(pluginDir) {
    const candidates = [
      path.join(pluginDir, '.venv', 'bin', 'python3'),
      path.join(pluginDir, 'venv', 'bin', 'python3'),
      '/usr/bin/python3',
      '/usr/local/bin/python3',
      'python3',
    ];

    for (const pythonPath of candidates) {
      if (fs.existsSync(pythonPath) || pythonPath === 'python3') {
        try {
          const { execSync } = require('child_process');
          execSync(`${pythonPath} -c "import aioairctrl"`, { stdio: 'ignore' });
          this.log.debug(`Found Python with aioairctrl: ${pythonPath}`);
          return pythonPath;
        } catch (e) {
          continue;
        }
      }
    }

    this.log.warn('Could not find Python with aioairctrl installed');
    this.log.warn('Please install: pip3 install aioairctrl');
    this.log.warn('Or specify pythonPath in config');
    return 'python3';
  }

  setupServices() {
    this.informationService = new Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, 'Philips')
      .setCharacteristic(Characteristic.Model, 'Air Purifier')
      .setCharacteristic(Characteristic.SerialNumber, this.host);

    this.purifierService = new Service.AirPurifier(this.name);

    this.purifierService
      .getCharacteristic(Characteristic.Active)
      .on('get', this.getPowerState.bind(this))
      .on('set', this.setPowerState.bind(this));

    this.purifierService
      .getCharacteristic(Characteristic.CurrentAirPurifierState)
      .on('get', this.getCurrentState.bind(this));

    this.purifierService
      .getCharacteristic(Characteristic.TargetAirPurifierState)
      .on('get', this.getTargetState.bind(this))
      .on('set', this.setTargetState.bind(this));

    this.purifierService
      .addCharacteristic(Characteristic.RotationSpeed)
      .on('get', this.getRotationSpeed.bind(this))
      .on('set', this.setRotationSpeed.bind(this));

    this.autoModeSwitch = new Service.Switch('Auto Mode');
    this.autoModeSwitch
      .getCharacteristic(Characteristic.On)
      .on('get', this.getAutoMode.bind(this))
      .on('set', this.setAutoMode.bind(this));

    this.airQualitySensor = new Service.AirQualitySensor('Air Quality');

    this.airQualitySensor
      .getCharacteristic(Characteristic.AirQuality)
      .on('get', this.getAirQuality.bind(this));

    this.airQualitySensor
      .addCharacteristic(Characteristic.PM2_5Density)
      .on('get', this.getPM25.bind(this));

    this.lightService = new Service.Lightbulb('Display Light');

    this.lightService
      .getCharacteristic(Characteristic.On)
      .on('get', this.getLightState.bind(this))
      .on('set', this.setLightState.bind(this));

    this.lightService
      .addCharacteristic(Characteristic.Brightness)
      .on('get', this.getLightBrightness.bind(this))
      .on('set', this.setLightBrightness.bind(this));
  }

  async executeCommand(command, ...args) {
    const cmdArgs = args.length > 0 ? ' ' + args.join(' ') : '';
    const cmd = `${this.pythonPath} ${this.apiScriptPath} ${this.host} ${command}${cmdArgs}`;

    this.log.debug(`Executing: ${cmd}`);

    try {
      const { stdout, stderr } = await execPromise(cmd);

      if (stderr && stderr.trim()) {
        this.log.debug(`stderr: ${stderr}`);
      }

      try {
        return JSON.parse(stdout);
      } catch {
        return stdout.trim();
      }
    } catch (error) {
      this.log.error(`Command failed: ${error.message}`);
      throw error;
    }
  }

  async updateStatus() {
    if (this.isUpdating) {
      this.log.debug('Update already in progress, skipping...');
      return;
    }

    this.isUpdating = true;
    try {
      const sensors = await this.executeCommand('sensors');

      this.state.power = sensors.power;
      this.state.mode = sensors.mode;
      this.state.lightLevel = sensors.light_level || 0;
      this.state.pm25 = sensors.pm25 || 0;
      this.state.iaql = sensors.iaql || 0;

      this.log.debug('Status updated:', this.state);

      this.purifierService
        .getCharacteristic(Characteristic.Active)
        .updateValue(this.state.power ? 1 : 0);

      const currentState = this.state.power
        ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR
        : Characteristic.CurrentAirPurifierState.INACTIVE;
      this.purifierService
        .getCharacteristic(Characteristic.CurrentAirPurifierState)
        .updateValue(currentState);

      const speedMap = {
        0: 100,
        17: 16,
        19: 50,
        18: 83,
        auto: 100,
        sleep: 16,
        medium: 50,
        turbo: 83,
      };
      const rotationSpeed = speedMap[this.state.mode] || 100;
      this.purifierService
        .getCharacteristic(Characteristic.RotationSpeed)
        .updateValue(rotationSpeed);

      const isAuto = this.state.mode === 0 || this.state.mode === 'auto' || this.state.mode === 'A';
      const targetState = isAuto
        ? Characteristic.TargetAirPurifierState.AUTO
        : Characteristic.TargetAirPurifierState.MANUAL;
      this.purifierService
        .getCharacteristic(Characteristic.TargetAirPurifierState)
        .updateValue(targetState);

      this.autoModeSwitch.getCharacteristic(Characteristic.On).updateValue(isAuto);

      if (this.state.pm25 > 0) {
        this.airQualitySensor
          .getCharacteristic(Characteristic.PM2_5Density)
          .updateValue(this.state.pm25);

        let airQuality = Characteristic.AirQuality.UNKNOWN;
        if (this.state.pm25 <= 12) {
          airQuality = Characteristic.AirQuality.EXCELLENT;
        } else if (this.state.pm25 <= 35) {
          airQuality = Characteristic.AirQuality.GOOD;
        } else if (this.state.pm25 <= 55) {
          airQuality = Characteristic.AirQuality.FAIR;
        } else if (this.state.pm25 <= 100) {
          airQuality = Characteristic.AirQuality.INFERIOR;
        } else {
          airQuality = Characteristic.AirQuality.POOR;
        }
        this.airQualitySensor.getCharacteristic(Characteristic.AirQuality).updateValue(airQuality);
      }

      const lightOn = this.state.lightLevel > 0;
      this.lightService.getCharacteristic(Characteristic.On).updateValue(lightOn);

      let brightness = 0;
      if (this.state.lightLevel === 0) {
        brightness = 0;
      } else if (this.state.lightLevel === 115) {
        brightness = 50;
      } else if (this.state.lightLevel === 123) {
        brightness = 100;
      }
      this.lightService.getCharacteristic(Characteristic.Brightness).updateValue(brightness);
    } catch (error) {
      this.log.error('Failed to update status:', error.message);
    } finally {
      this.isUpdating = false;
    }
  }

  startPolling() {
    this.stopPolling();
    this.updateStatus();
    this.pollTimer = setInterval(() => {
      this.updateStatus();
    }, this.pollInterval);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  clearAllTimeouts() {
    this.pendingTimeouts.forEach(timeout => clearTimeout(timeout));
    this.pendingTimeouts = [];
  }

  safeSetTimeout(callback, delay) {
    const timeout = setTimeout(() => {
      this.pendingTimeouts = this.pendingTimeouts.filter(t => t !== timeout);
      callback();
    }, delay);
    this.pendingTimeouts.push(timeout);
    return timeout;
  }

  async getPowerState(callback) {
    try {
      callback(null, this.state.power ? 1 : 0);
    } catch (error) {
      callback(error);
    }
  }

  async setPowerState(value, callback) {
    try {
      const powerState = value === 1 ? 'on' : 'off';
      this.log.info(`[setPowerState] Setting power to ${powerState}`);
      this.log.debug(
        `[setPowerState] Current state - power: ${this.state.power}, mode: ${this.state.mode}, lightLevel: ${this.state.lightLevel}`
      );

      if (!value) {
        if (this.state.lightLevel > 0) {
          this.lastLightLevel = this.state.lightLevel;
          this.log.info(`[setPowerState] Stored last light level: ${this.lastLightLevel}`);
        }

        const wasAutoMode =
          this.state.mode === 'auto' || this.state.mode === 0 || this.state.mode === 'A';
        if (wasAutoMode) {
          this.log.info(
            '[setPowerState] Device is in auto mode, switching to manual (medium) before turning off'
          );
          try {
            await this.executeCommand('mode', 'medium');
            this.state.mode = 'medium';
            this.log.info('[setPowerState] Successfully set mode to medium');
          } catch (error) {
            this.log.error(`[setPowerState] Failed to set mode to medium: ${error.message}`);
          }
        }

        await this.executeCommand('power', powerState);
        this.state.power = false;

        this.autoModeSwitch.getCharacteristic(Characteristic.On).updateValue(false);
        this.log.info('[setPowerState] Auto Mode switch turned off');

        await this.executeCommand('light', '0');
        this.state.lightLevel = 0;
        this.lightService.getCharacteristic(Characteristic.On).updateValue(false);
        this.lightService.getCharacteristic(Characteristic.Brightness).updateValue(0);
        this.log.info('[setPowerState] Light turned off');
      } else {
        await this.executeCommand('power', powerState);
        this.state.power = true;

        if (this.lastLightLevel > 0) {
          this.log.info(`[setPowerState] Restoring last light level: ${this.lastLightLevel}`);
          try {
            await this.executeCommand('light', this.lastLightLevel.toString());
            this.state.lightLevel = this.lastLightLevel;

            const lightOn = this.lastLightLevel > 0;
            let brightness = 0;
            if (this.lastLightLevel === 115) brightness = 50;
            else if (this.lastLightLevel === 123) brightness = 100;

            this.lightService.getCharacteristic(Characteristic.On).updateValue(lightOn);
            this.lightService.getCharacteristic(Characteristic.Brightness).updateValue(brightness);
            this.log.info(
              `[setPowerState] Light restored to level ${this.lastLightLevel} (brightness: ${brightness}%)`
            );
          } catch (error) {
            this.log.error(`[setPowerState] Failed to restore light level: ${error.message}`);
          }
        }
      }

      this.log.info(`[setPowerState] Power set to ${powerState} - complete`);
      this.safeSetTimeout(() => this.updateStatus(), 1000);
      callback(null);
    } catch (error) {
      this.log.error(`[setPowerState] Failed to set power: ${error.message}`);
      callback(error);
    }
  }

  async getCurrentState(callback) {
    try {
      if (!this.state.power) {
        callback(null, Characteristic.CurrentAirPurifierState.INACTIVE);
      } else {
        callback(null, Characteristic.CurrentAirPurifierState.PURIFYING_AIR);
      }
    } catch (error) {
      callback(error);
    }
  }

  async getTargetState(callback) {
    try {
      const isAuto = this.state.mode === 'A' || this.state.mode === 'auto';
      callback(
        null,
        isAuto
          ? Characteristic.TargetAirPurifierState.AUTO
          : Characteristic.TargetAirPurifierState.MANUAL
      );
    } catch (error) {
      callback(error);
    }
  }

  async setTargetState(value, callback) {
    try {
      const mode = value === Characteristic.TargetAirPurifierState.AUTO ? 'auto' : 'medium';
      await this.executeCommand('mode', mode);
      this.state.mode = mode;
      this.log.info(`Mode set to ${mode}`);
      callback(null);
    } catch (error) {
      this.log.error('Failed to set mode:', error);
      callback(error);
    }
  }

  async getRotationSpeed(callback) {
    try {
      const speedMap = {
        0: 100,
        17: 16,
        19: 50,
        18: 83,
        auto: 100,
        sleep: 16,
        medium: 50,
        turbo: 83,
      };

      const speed = speedMap[this.state.mode] || 100;
      callback(null, speed);
    } catch (error) {
      callback(error);
    }
  }

  async setRotationSpeed(value, callback) {
    try {
      if (value === 0) {
        this.log.info('[setRotationSpeed] Fan set to 0%, turning off device');
        this.log.debug(
          `[setRotationSpeed] Current state - power: ${this.state.power}, mode: ${this.state.mode}, lightLevel: ${this.state.lightLevel}`
        );

        if (this.state.lightLevel > 0) {
          this.lastLightLevel = this.state.lightLevel;
          this.log.info(`[setRotationSpeed] Stored last light level: ${this.lastLightLevel}`);
        }

        const wasAutoMode =
          this.state.mode === 'auto' || this.state.mode === 0 || this.state.mode === 'A';
        if (wasAutoMode) {
          this.log.info(
            '[setRotationSpeed] Device is in auto mode, switching to manual (medium) before turning off'
          );
          try {
            await this.executeCommand('mode', 'medium');
            this.state.mode = 'medium';
            this.log.info('[setRotationSpeed] Successfully set mode to medium');
          } catch (error) {
            this.log.error(`[setRotationSpeed] Failed to set mode to medium: ${error.message}`);
          }
        }

        await this.executeCommand('power', 'off');
        this.state.power = false;
        this.log.info('[setRotationSpeed] Device power turned off');

        this.autoModeSwitch.getCharacteristic(Characteristic.On).updateValue(false);
        this.log.info('[setRotationSpeed] Auto Mode switch turned off');

        await this.executeCommand('light', '0');
        this.state.lightLevel = 0;
        this.lightService.getCharacteristic(Characteristic.On).updateValue(false);
        this.lightService.getCharacteristic(Characteristic.Brightness).updateValue(0);
        this.log.info('[setRotationSpeed] Light turned off');

        this.purifierService.getCharacteristic(Characteristic.Active).updateValue(0);

        this.log.info('[setRotationSpeed] Device turned off (fan set to 0%) - complete');
        this.safeSetTimeout(() => this.updateStatus(), 1000);
        callback(null);
        return;
      }

      if (!this.state.power) {
        this.log.info('[setRotationSpeed] Device is off, turning on before setting mode');
        await this.executeCommand('power', 'on');
        this.state.power = true;
        this.purifierService.getCharacteristic(Characteristic.Active).updateValue(1);

        if (this.lastLightLevel > 0) {
          this.log.info(`[setRotationSpeed] Restoring last light level: ${this.lastLightLevel}`);
          try {
            await this.executeCommand('light', this.lastLightLevel.toString());
            this.state.lightLevel = this.lastLightLevel;

            const lightOn = this.lastLightLevel > 0;
            let brightness = 0;
            if (this.lastLightLevel === 115) brightness = 50;
            else if (this.lastLightLevel === 123) brightness = 100;

            this.lightService.getCharacteristic(Characteristic.On).updateValue(lightOn);
            this.lightService.getCharacteristic(Characteristic.Brightness).updateValue(brightness);
            this.log.info(
              `[setRotationSpeed] Light restored to level ${this.lastLightLevel} (brightness: ${brightness}%)`
            );
          } catch (error) {
            this.log.error(`[setRotationSpeed] Failed to restore light level: ${error.message}`);
          }
        }
      }

      let mode = 'sleep';
      if (value <= 33) {
        mode = 'sleep';
      } else if (value <= 66) {
        mode = 'medium';
      } else {
        mode = 'turbo';
      }

      await this.executeCommand('mode', mode);
      this.state.mode = mode;

      this.autoModeSwitch.getCharacteristic(Characteristic.On).updateValue(false);

      this.log.info(`Mode set to ${mode} (speed: ${value}%)`);
      this.safeSetTimeout(() => this.updateStatus(), 1000);
      callback(null);
    } catch (error) {
      this.log.error('Failed to set rotation speed:', error);
      callback(error);
    }
  }

  async getAirQuality(callback) {
    try {
      const pm25 = this.state.pm25 || 0;

      let quality = Characteristic.AirQuality.UNKNOWN;
      if (pm25 === 0) {
        quality = Characteristic.AirQuality.UNKNOWN;
      } else if (pm25 <= 12) {
        quality = Characteristic.AirQuality.EXCELLENT;
      } else if (pm25 <= 35) {
        quality = Characteristic.AirQuality.GOOD;
      } else if (pm25 <= 55) {
        quality = Characteristic.AirQuality.FAIR;
      } else if (pm25 <= 100) {
        quality = Characteristic.AirQuality.INFERIOR;
      } else {
        quality = Characteristic.AirQuality.POOR;
      }

      this.log.debug(`Air Quality: PM2.5=${pm25} → ${quality}`);
      callback(null, quality);
    } catch (error) {
      callback(error);
    }
  }

  async getPM25(callback) {
    try {
      const value = this.state.pm25 || 0;
      this.log.debug(`PM2.5 Density: ${value}`);
      callback(null, value);
    } catch (error) {
      callback(error);
    }
  }

  async getAutoMode(callback) {
    try {
      const isAuto = this.state.mode === 0 || this.state.mode === 'auto' || this.state.mode === 'A';
      callback(null, isAuto);
    } catch (error) {
      callback(error);
    }
  }

  async setAutoMode(value, callback) {
    try {
      this.log.info(`[setAutoMode] Setting auto mode to ${value}`);
      this.log.debug(
        `[setAutoMode] Current state - power: ${this.state.power}, mode: ${this.state.mode}`
      );

      if (value) {
        if (!this.state.power) {
          this.log.info('[setAutoMode] Device is off, turning on first');
          await this.executeCommand('power', 'on');
          this.state.power = true;
          this.purifierService.getCharacteristic(Characteristic.Active).updateValue(1);

          if (this.lastLightLevel > 0) {
            this.log.info(`[setAutoMode] Restoring last light level: ${this.lastLightLevel}`);
            try {
              await this.executeCommand('light', this.lastLightLevel.toString());
              this.state.lightLevel = this.lastLightLevel;

              const lightOn = this.lastLightLevel > 0;
              let brightness = 0;
              if (this.lastLightLevel === 115) brightness = 50;
              else if (this.lastLightLevel === 123) brightness = 100;

              this.lightService.getCharacteristic(Characteristic.On).updateValue(lightOn);
              this.lightService
                .getCharacteristic(Characteristic.Brightness)
                .updateValue(brightness);
              this.log.info(
                `[setAutoMode] Light restored to level ${this.lastLightLevel} (brightness: ${brightness}%)`
              );
            } catch (error) {
              this.log.error(`[setAutoMode] Failed to restore light level: ${error.message}`);
            }
          }

          this.log.info('[setAutoMode] Device turned on');
        }

        await this.executeCommand('mode', 'auto');
        this.state.mode = 'auto';
        this.log.info('[setAutoMode] Auto Mode enabled');

        this.purifierService.getCharacteristic(Characteristic.RotationSpeed).updateValue(100);
      } else {
        await this.executeCommand('mode', 'medium');
        this.state.mode = 'medium';
        this.log.info('[setAutoMode] Auto Mode disabled, switched to manual (medium)');

        this.purifierService.getCharacteristic(Characteristic.RotationSpeed).updateValue(50);
      }

      this.log.info(`[setAutoMode] Auto mode set to ${value} - complete`);
      this.safeSetTimeout(() => this.updateStatus(), 1000);
      callback(null);
    } catch (error) {
      this.log.error(`[setAutoMode] Failed to set auto mode: ${error.message}`);
      callback(error);
    }
  }

  async getLightState(callback) {
    try {
      callback(null, this.state.lightLevel > 0);
    } catch (error) {
      callback(error);
    }
  }

  async setLightState(value, callback) {
    try {
      const deviceLevel = value
        ? this.state.lightLevel > 0
          ? this.state.lightLevel
          : this.lastLightLevel > 0
            ? this.lastLightLevel
            : 123
        : 0;

      if (value && deviceLevel > 0) {
        this.lastLightLevel = deviceLevel;
        this.log.debug(`[setLightState] Updated last light level to: ${this.lastLightLevel}`);
      }

      await this.executeCommand('light', deviceLevel.toString());
      this.state.lightLevel = deviceLevel;
      this.log.info(
        `[setLightState] Light set to ${value ? 'on' : 'off'} (device: ${deviceLevel})`
      );
      this.safeSetTimeout(() => this.updateStatus(), 1000);
      callback(null);
    } catch (error) {
      this.log.error(`[setLightState] Failed to set light state: ${error.message}`);
      callback(error);
    }
  }

  async getLightBrightness(callback) {
    try {
      let brightness = 0;
      if (this.state.lightLevel === 115) brightness = 50;
      else if (this.state.lightLevel === 123) brightness = 100;
      callback(null, brightness);
    } catch (error) {
      callback(error);
    }
  }

  async setLightBrightness(value, callback) {
    try {
      let deviceLevel = 0;
      let adjustedBrightness = 0;

      if (value === 0) {
        deviceLevel = 0;
        adjustedBrightness = 0;
      } else if (value >= 1 && value <= 50) {
        deviceLevel = 115;
        adjustedBrightness = 50;
      } else if (value >= 51 && value <= 100) {
        deviceLevel = 123;
        adjustedBrightness = 100;
      }

      if (deviceLevel > 0) {
        this.lastLightLevel = deviceLevel;
        this.log.debug(`[setLightBrightness] Updated last light level to: ${this.lastLightLevel}`);
      }

      await this.executeCommand('light', deviceLevel.toString());
      this.state.lightLevel = deviceLevel;

      this.lightService
        .getCharacteristic(Characteristic.Brightness)
        .updateValue(adjustedBrightness);

      this.log.info(
        `[setLightBrightness] Light brightness set to ${value}% → snapped to ${adjustedBrightness}% (device: ${deviceLevel} - ${deviceLevel === 115 ? 'dim' : deviceLevel === 123 ? 'full' : 'off'})`
      );
      this.safeSetTimeout(() => this.updateStatus(), 1000);
      callback(null);
    } catch (error) {
      this.log.error(`[setLightBrightness] Failed to set light brightness: ${error.message}`);
      callback(error);
    }
  }

  getServices() {
    return [
      this.informationService,
      this.purifierService,
      this.autoModeSwitch,
      this.airQualitySensor,
      this.lightService,
    ];
  }

  configure() {
    this.stopPolling();
    this.clearAllTimeouts();
    this.startPolling();
  }

  identify(callback) {
    this.log.info(`Identify requested for ${this.name}`);
    callback(null);
  }
}
