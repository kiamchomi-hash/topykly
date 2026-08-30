// Trabajo que sigue despues de haber respondido, como mandar los emails de
// actividad de un tema.
//
// En un proceso de larga vida alcanza con dejar la promesa corriendo. En
// serverless no: apenas se envia la respuesta la instancia puede congelarse y
// ese trabajo no llega a terminar. waitUntil le pide a la plataforma que
// mantenga viva la invocacion hasta que la promesa se resuelva.

let waitUntilPromise = null;

async function loadWaitUntil() {
  // Fuera de Vercel no hay nada que esperar y el modulo no aplica.
  if (!process.env.VERCEL) {
    return null;
  }

  if (!waitUntilPromise) {
    waitUntilPromise = import("@vercel/functions")
      .then((module) => module.waitUntil || null)
      .catch(() => null);
  }

  return await waitUntilPromise;
}

export function runAfterResponse(task, onError = console.error) {
  const pending = Promise.resolve()
    .then(task)
    .catch((error) => {
      onError(error);
    });

  void loadWaitUntil().then((waitUntil) => {
    try {
      waitUntil?.(pending);
    } catch {
      // Fuera de un contexto de peticion waitUntil no aplica; la promesa sigue
      // corriendo igual en un proceso de larga vida.
    }
  });

  return pending;
}
