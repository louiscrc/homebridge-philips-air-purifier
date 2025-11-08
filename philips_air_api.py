#!/usr/bin/env python3
import asyncio
import json
import sys
from typing import Dict, Any, Optional
from aioairctrl.coap.client import Client


class PhilipsAirPurifier:
    PARAM_POWER = "D03102"
    PARAM_MODE = "D0310C"
    PARAM_LIGHT = "D03104"
    PARAM_CHILD_LOCK = "D03103"
    
    MODE_AUTO = 0
    MODE_SLEEP = 17
    MODE_MEDIUM = 19
    MODE_TURBO = 18
    
    LIGHT_OFF = 0
    LIGHT_DIM = 115
    LIGHT_BRIGHT = 123
    
    def __init__(self, host: str, port: int = 5683, max_retries: int = 3):
        self.host = host
        self.port = port
        self._client: Optional[Client] = None
        self.max_retries = max_retries
    
    async def connect(self):
        self._client = await Client.create(self.host, self.port)
    
    async def disconnect(self):
        if self._client:
            await self._client.shutdown()
            self._client = None
    
    async def get_status(self) -> Dict[str, Any]:
        if not self._client:
            await self.connect()
        
        last_error = None
        for attempt in range(self.max_retries):
            try:
                status, max_age = await self._client.get_status()
                return status
            except (ValueError, Exception) as e:
                error_msg = str(e)
                if "non-hexadecimal" in error_msg or "decrypt" in error_msg.lower():
                    last_error = e
                    if attempt < self.max_retries - 1:
                        await self.disconnect()
                        await asyncio.sleep(0.5 * (attempt + 1))
                        await self.connect()
                        continue
                raise
        
        raise Exception(f"Failed to get status after {self.max_retries} attempts: {last_error}")
    
    async def get_power(self) -> bool:
        status = await self.get_status()
        value = status.get(self.PARAM_POWER, 0)
        return bool(value)
    
    async def set_power(self, on: bool) -> bool:
        if not self._client:
            await self.connect()
        
        value = 1 if on else 0
        return await self._client.set_control_value(self.PARAM_POWER, value)
    
    async def get_mode(self) -> str:
        status = await self.get_status()
        return status.get(self.PARAM_MODE, "unknown")
    
    async def set_mode(self, mode: str) -> bool:
        if not self._client:
            await self.connect()
        
        mode_map = {
            "auto": self.MODE_AUTO,
            "sleep": self.MODE_SLEEP,
            "medium": self.MODE_MEDIUM,
            "turbo": self.MODE_TURBO,
        }
        
        if mode.lower() not in mode_map:
            raise ValueError(f"Invalid mode: {mode}. Must be one of {list(mode_map.keys())}")
        
        value = mode_map[mode.lower()]
        return await self._client.set_control_value(self.PARAM_MODE, value)
    
    async def get_air_quality(self) -> Dict[str, Any]:
        status = await self.get_status()
        
        return {
            "pm25": status.get("pm25") or status.get("D03221"),
            "iaql": status.get("iaql") or status.get("D03120"),
            "tvoc": status.get("tvoc"),
        }
    
    async def get_light_level(self) -> int:
        status = await self.get_status()
        return status.get(self.PARAM_LIGHT, 0)
    
    async def set_light_level(self, level: int) -> bool:
        if not self._client:
            await self.connect()
        
        if level == 0:
            device_value = self.LIGHT_OFF
        elif level <= 50:
            device_value = self.LIGHT_DIM
        elif level <= 115:
            device_value = level
        else:
            device_value = self.LIGHT_BRIGHT
        
        return await self._client.set_control_value(self.PARAM_LIGHT, device_value)
    
    async def get_sensors(self) -> Dict[str, Any]:
        status = await self.get_status()
        
        filter_total = status.get("D05408", 9600)
        filter_remaining = status.get("D0540E", 0)
        filter_life_percent = (filter_remaining / filter_total * 100) if filter_total > 0 else 0
        
        cleanup_max_interval = status.get("D05207", 720)
        cleanup_time_until_next = status.get("D0520D", 0)
        cleanup_percent = (cleanup_time_until_next / cleanup_max_interval * 100) if cleanup_max_interval > 0 else 0
        
        return {
            "power": bool(status.get(self.PARAM_POWER, 0)),
            "mode": status.get(self.PARAM_MODE, "unknown"),
            "mode_name": self._get_mode_name(status.get(self.PARAM_MODE)),
            "pm25": status.get("D03221"),
            "iaql": status.get("D03120"),
            "tvoc": status.get("tvoc"),
            "light_level": status.get(self.PARAM_LIGHT, 0),
            "filter_life_percent": round(filter_life_percent, 1),
            "filter_life_hours": filter_remaining,
            "filter_total_hours": filter_total,
            "cleanup_percent": round(cleanup_percent, 1),
            "cleanup_hours_until_next": cleanup_time_until_next,
            "cleanup_max_interval": cleanup_max_interval,
            "temperature": status.get("temp"),
            "humidity": status.get("rh"),
            "runtime": status.get("Runtime"),
            "wifi_rssi": status.get("rssi"),
        }
    
    def _get_mode_name(self, mode_value) -> str:
        mode_map = {
            self.MODE_AUTO: "auto",
            self.MODE_SLEEP: "sleep",
            self.MODE_MEDIUM: "medium",
            self.MODE_TURBO: "turbo",
        }
        return mode_map.get(mode_value, f"unknown ({mode_value})")
    
    async def get_child_lock(self) -> bool:
        status = await self.get_status()
        return bool(status.get(self.PARAM_CHILD_LOCK, 0))
    
    async def set_child_lock(self, enabled: bool) -> bool:
        if not self._client:
            await self.connect()
        
        value = 1 if enabled else 0
        return await self._client.set_control_value(self.PARAM_CHILD_LOCK, value)


async def handle_command(host: str, command: str, *args):
    purifier = PhilipsAirPurifier(host, max_retries=3)
    
    try:
        await purifier.connect()
        
        if command == "status":
            result = await purifier.get_status()
            print(json.dumps(result, indent=2))
        
        elif command == "sensors":
            result = await purifier.get_sensors()
            print(json.dumps(result, indent=2))
        
        elif command == "power":
            if args:
                on = args[0].lower() in ["on", "1", "true"]
                await purifier.set_power(on)
                print(f"Power set to {'ON' if on else 'OFF'}")
            else:
                is_on = await purifier.get_power()
                print(f"Power: {'ON' if is_on else 'OFF'}")
        
        elif command == "mode":
            if args:
                await purifier.set_mode(args[0])
                print(f"Mode set to {args[0]}")
            else:
                mode = await purifier.get_mode()
                print(f"Mode: {mode}")
        
        elif command == "light":
            if args:
                level = int(args[0])
                await purifier.set_light_level(level)
                print(f"Light level set to {level}")
            else:
                level = await purifier.get_light_level()
                print(f"Light level: {level}")
        
        elif command == "airquality":
            result = await purifier.get_air_quality()
            print(json.dumps(result, indent=2))
        
        elif command == "childlock":
            if args:
                enabled = args[0].lower() in ["on", "1", "true", "enabled"]
                await purifier.set_child_lock(enabled)
                print(f"Child lock {'enabled' if enabled else 'disabled'}")
            else:
                is_enabled = await purifier.get_child_lock()
                print(f"Child lock: {'ON' if is_enabled else 'OFF'}")
        
        else:
            print(f"Unknown command: {command}")
            print("\nAvailable commands:")
            print("  status                    - Get full device status")
            print("  sensors                   - Get all sensor readings")
            print("  power [on|off]            - Get/set power state")
            print("  mode [auto|sleep|medium|turbo] - Get/set mode")
            print("  light [0|115|123]         - Get/set light (0=off, 115=dim, 123=bright)")
            print("  airquality                - Get air quality readings")
            print("  childlock [on|off]        - Get/set child lock")
            return 1
        
        return 0
        
    finally:
        await purifier.disconnect()


def main():
    if len(sys.argv) < 3:
        print("Usage: philips_air_api.py <host> <command> [args...]")
        print("\nExample:")
        print("  philips_air_api.py 192.168.8.30 status")
        print("  philips_air_api.py 192.168.8.30 power on")
        print("  philips_air_api.py 192.168.8.30 mode sleep")
        print("  philips_air_api.py 192.168.8.30 light 50")
        sys.exit(1)
    
    host = sys.argv[1]
    command = sys.argv[2]
    args = sys.argv[3:]
    
    exit_code = asyncio.run(handle_command(host, command, *args))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
