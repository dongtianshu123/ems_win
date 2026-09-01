class SerializedPoller {
  constructor() {
    this.busy = false;
    this.stats = {
      cyclesCompleted: 0,
      cyclesSkipped: 0,
      taskFailures: 0,
    };
  }

  async runCycle(tasks) {
    if (this.busy) {
      this.stats.cyclesSkipped += 1;
      return { skipped: true, reason: "cycle_busy" };
    }

    this.busy = true;
    const results = [];
    try {
      for (const task of tasks) {
        try {
          results.push({ id: task.id, ok: true, value: await task.run() });
        } catch (error) {
          this.stats.taskFailures += 1;
          results.push({ id: task.id, ok: false, error });
        }
      }
      this.stats.cyclesCompleted += 1;
      return { skipped: false, results };
    } finally {
      this.busy = false;
    }
  }
}

function groupDevicesByEndpoint(devices) {
  const groups = new Map();
  for (const device of devices) {
    const key = `${device.host}:${device.port}`;
    if (!groups.has(key)) groups.set(key, { key, host: device.host, port: device.port, devices: [] });
    groups.get(key).devices.push(device);
  }
  return [...groups.values()];
}

async function runWithConcurrency(items, limit, worker) {
  const maximum = Math.max(1, Math.floor(Number(limit) || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(maximum, items.length) }, () => runNext()));
  return results;
}

module.exports = { groupDevicesByEndpoint, runWithConcurrency, SerializedPoller };
