import("./services/preview-server.js")
  .then(({ startPreviewServer }) => {
    startPreviewServer({ port: 4173, log: (message) => process.stdout.write(`${message}\n`) });
    startPreviewServer({ port: 4174, log: (message) => process.stdout.write(`${message}\n`) });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
