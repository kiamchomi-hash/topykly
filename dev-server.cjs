import("./services/preview-server.js")
  .then(async ({ startPreviewServer }) => {
    const log = (message) => process.stdout.write(`${message}\n`);
    // En serie: los dos comparten la misma base y el segundo no debe abrirla
    // mientras el primero todavia esta inicializando el esquema.
    await startPreviewServer({ port: 4173, log });
    await startPreviewServer({ port: 4174, log });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
