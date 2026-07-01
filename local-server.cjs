import("./services/preview-server.js")
  .then(({ startPreviewServer }) => {
    startPreviewServer({ port: Number(process.env.PORT) || 4173 });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
