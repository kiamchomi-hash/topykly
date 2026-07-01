import("./services/preview-server.js")
  .then(({ startPreviewServer }) => {
    startPreviewServer({
      port: Number(process.env.PORT) || 4173,
      host: process.env.PORT ? "0.0.0.0" : "127.0.0.1"
    });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
