const WebSocket = require("ws");

function checkSource(url, expectedSource, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket source check timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    socket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { return; }
      if (message.type !== "scada_update" || !message.data?.meta?.source) return;
      clearTimeout(timeout);
      socket.close();
      if (message.data.meta.source !== expectedSource) {
        reject(new Error(`expected source ${expectedSource}, received ${message.data.meta.source}`));
        return;
      }
      resolve(message.data.meta);
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

if (require.main === module) {
  const [, , url, expectedSource, timeoutText] = process.argv;
  checkSource(url, expectedSource, Number(timeoutText) || 12000)
    .then((meta) => {
      console.log(JSON.stringify({ ok: true, source: meta.source, quality: meta.quality }));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 2;
    });
}

module.exports = { checkSource };
