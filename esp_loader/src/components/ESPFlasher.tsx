import { useEffect, useRef, useState } from "react";
import { ESPLoader, Transport } from "esptool-js";

export default function ESPFlasher() {

  const [connected, setConnected] = useState(false);

  const [logs, setLogs] = useState("");

  const [port, setPort] = useState<any>(null);

  const [firmware, setFirmware] = useState<File | null>(null);

  const [firmwareName, setFirmwareName] = useState("");

  const [availableFirmwares, setAvailableFirmwares] = useState<string[]>([]);

  const [selectedFirmwareFile, setSelectedFirmwareFile] = useState("");

  const [flashAddress, setFlashAddress] = useState("0x0000");

  const [flashing, setFlashing] = useState(false);

  const [progress, setProgress] = useState(0);

  const readerRef = useRef<any>(null);

  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  function getSerialApi() {
    return (navigator as Navigator & { serial?: any }).serial;
  }

  async function stopReading() {
    if (!readerRef.current) return;

    try {
      await readerRef.current.cancel();
    } catch {
      // Reader may already be closed.
    }

    try {
      readerRef.current.releaseLock();
    } catch {
      // Lock may already be released.
    }

    readerRef.current = null;
  }

  async function openPortSafely(selectedPort: any, baudRate = 115200) {
    if (!selectedPort) return;

    try {
      await selectedPort.open({ baudRate });
    } catch (err: any) {
      if (err?.name !== "InvalidStateError") {
        throw err;
      }
    }
  }

  function addLog(text: string) {
    setLogs((prev) => prev + text);
  }

  function getPublicUrls(filePath: string) {
    const normalizedPath = filePath.startsWith("/")
      ? filePath.slice(1)
      : filePath;

    const baseUrl = import.meta.env.BASE_URL ?? "/";
    const primary = `${baseUrl}${normalizedPath}`;
    const fallback = `/${normalizedPath}`;

    return primary === fallback ? [primary] : [primary, fallback];
  }

  async function delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function loadFirmwareManifest() {
    try {
      const manifestUrls = getPublicUrls("firmware/manifest.json");
      let response: Response | null = null;

      for (const manifestUrl of manifestUrls) {
        const currentResponse = await fetch(manifestUrl, { cache: "no-store" });
        if (currentResponse.ok) {
          response = currentResponse;
          break;
        }
      }

      if (!response) {
        addLog("No se pudo leer manifest.json (404)\n");
        return;
      }

      const payload = await response.json();
      const files = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.files)
          ? payload.files
          : [];

      const normalizedFiles = files.filter(
        (file: unknown) =>
          typeof file === "string" && file.toLowerCase().endsWith(".bin")
      );

      if (normalizedFiles.length === 0) {
        addLog("No hay firmwares en manifest.json\n");
        return;
      }

      setAvailableFirmwares(normalizedFiles);

      setSelectedFirmwareFile((current) =>
        current && normalizedFiles.includes(current)
          ? current
          : normalizedFiles[0]
      );
    } catch (err: any) {
      console.error("Error cargando manifest:", err);
      addLog(`Error cargando lista de firmwares: ${err.message}\n`);
    }
  }

  async function loadDefaultFirmware() {
    try {
      if (!selectedFirmwareFile) {
        addLog("Selecciona un firmware del menu\n");
        return;
      }

      addLog(`Cargando firmware: ${selectedFirmwareFile}...\n`);
      const firmwareUrls = getPublicUrls(`firmware/${selectedFirmwareFile}`);
      let response: Response | null = null;

      for (const firmwareUrl of firmwareUrls) {
        const currentResponse = await fetch(firmwareUrl);
        if (currentResponse.ok) {
          response = currentResponse;
          break;
        }
      }

      if (!response) {
        addLog("Error HTTP: 404 Not Found\n");
        return;
      }

      addLog(`Respuesta HTTP: ${response.status} ${response.statusText}\n`);
      
      const blob = await response.blob();
      addLog(`Blob cargado: ${blob.size} bytes\n`);
      
      const file = new File([blob], selectedFirmwareFile, { type: "application/octet-stream" });
      setFirmware(file);
      setFirmwareName(selectedFirmwareFile);
      addLog(`✓ Firmware cargado: ${selectedFirmwareFile} (${file.size} bytes)\n`);
    } catch (err: any) {
      console.error("Error en loadDefaultFirmware:", err);
      addLog(`✗ Error cargando firmware: ${err.message}\n`);
    }
  }

  async function connectESP() {

    try {

      const serial = getSerialApi();

      if (!serial) {

        alert("Web Serial API no soportado");

        return;
      }

      const selectedPort = await serial.requestPort();

      await openPortSafely(selectedPort, 115200);

      setPort(selectedPort);

      setConnected(true);

      addLog("ESP conectado\n");

      void startReading(selectedPort);

    } catch (err: any) {

      console.error(err);

      addLog(`Connect Error: ${err.message}\n`);
    }
  }

  async function startReading(selectedPort: any) {

    try {

      if (!selectedPort.readable) return;

      const reader = selectedPort.readable.getReader();

      readerRef.current = reader;

      while (true) {

        const { value, done } = await reader.read();

        if (done) break;

        if (value) {

          const text = new TextDecoder().decode(value);

          addLog(text);
        }
      }

      try {
        readerRef.current?.releaseLock();
      } catch {
        // No-op.
      }
      readerRef.current = null;

    } catch (err: any) {

      console.error(err);

      addLog(`Read Error: ${err.message}\n`);

    } finally {
      try {
        readerRef.current?.releaseLock();
      } catch {
        // No-op.
      }
      readerRef.current = null;
    }
  }

  async function disconnectESP() {

    try {

      if (readerRef.current) {

        await readerRef.current.cancel();

        readerRef.current.releaseLock();
      }

      if (port) {

        await port.close();
      }

      setConnected(false);

      setPort(null);

      addLog("\nESP desconectado\n");

    } catch (err: any) {

      console.error(err);

      addLog(`Disconnect Error: ${err.message}\n`);
    }
  }

  async function flashFirmware() {

    try {

      if (!port) {

        alert("Conecta el ESP32");

        return;
      }

      if (!firmware) {

        alert("Selecciona un firmware");

        return;
      }

      setFlashing(true);

      setProgress(0);

      addLog("\nInicializando esptool...\n");

      await stopReading();
      await delay(50);

      try {
        await port.close();
      } catch {
        // Already closed or closing.
      }

      await delay(100);

      const transport = new Transport(port);

      const esploader = new ESPLoader({

        transport,

        baudrate: 115200,

        terminal: {

          clean() {},

          writeLine(data: string) {
            addLog(data + "\n");
          },

          write(data: string) {
            addLog(data);
          },
        },
      });

      await esploader.main("default_reset");

      addLog("ESP detectado correctamente\n");

      const firmwareBuffer = await firmware.arrayBuffer();

      const binary = new Uint8Array(firmwareBuffer);

      const parsedFlashAddress = Number.parseInt(flashAddress, 16);

      addLog("Iniciando flasheo...\n");

      await esploader.writeFlash({

        fileArray: [

          {
            data: binary,
            address: parsedFlashAddress,
          },
        ],

        flashSize: "keep",

        flashMode: "keep",

        flashFreq: "keep",

        eraseAll: false,

        compress: true,

        reportProgress: (
          _fileIndex: number,
          written: number,
          total: number
        ) => {

          const percent =
            Number(((written / total) * 100).toFixed(1));

          setProgress(percent);
        },
      });

      addLog("\nFirmware cargado correctamente\n");

      setProgress(100);

      await esploader.transport.disconnect();

      setConnected(false);
      setPort(null);

      addLog("ESP liberado\n");

      setFlashing(false);

    } catch (err: any) {

      console.error(err);

      addLog(`\nFlash Error: ${err.message}\n`);

      setFlashing(false);
    }
  }

  async function eraseFlash() {

    try {

      if (!port) {

        alert("Conecta el ESP32");

        return;
      }

      setFlashing(true);

      setProgress(0);

      addLog("\nInicializando borrado...\n");

      await stopReading();
      await delay(50);

      try {
        await port.close();
      } catch {
        // Already closed or closing.
      }

      await delay(100);

      const transport = new Transport(port);

      const esploader = new ESPLoader({

        transport,

        baudrate: 115200,

        terminal: {

          clean() {},

          writeLine(data: string) {
            addLog(data + "\n");
          },

          write(data: string) {
            addLog(data);
          },
        },
      });

      await esploader.main("default_reset");

      addLog("ESP detectado correctamente\n");
      addLog("Iniciando borrado total...\n");

      await esploader.eraseFlash();

      addLog("\nFlash borrada correctamente\n");

      setProgress(100);

      await esploader.transport.disconnect();

      setConnected(false);
      setPort(null);

      addLog("ESP liberado\n");

      setFlashing(false);

    } catch (err: any) {

      console.error(err);

      addLog(`\nErase Error: ${err.message}\n`);

      setFlashing(false);
    }
  }

  async function sendCommand(cmd: string) {

    try {

      if (!port?.writable) return;

      const writer = port.writable.getWriter();

      const data = new TextEncoder().encode(cmd + "\n");

      await writer.write(data);

      writer.releaseLock();

      addLog(`>> ${cmd}\n`);

    } catch (err: any) {

      console.error(err);

      addLog(`Write Error: ${err.message}\n`);
    }
  }

  useEffect(() => {
    void loadFirmwareManifest();

    return () => {
      disconnectESP();
    };

  }, []);

  useEffect(() => {
    const logsElement = logsContainerRef.current;
    if (!logsElement) return;

    logsElement.scrollTop = logsElement.scrollHeight;
  }, [logs]);

  const buttonClass =
    "rounded-lg border border-sky-300/80 bg-sky-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-400 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50";

  const inputClass =
    "rounded-lg border border-slate-300 bg-white/85 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400";

  return (

    <div className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 md:px-8">

      <div className="rounded-2xl border border-slate-200 bg-white/85 p-5 shadow-lg shadow-sky-100/70 backdrop-blur md:p-8">

        <div className="mb-6 flex flex-wrap items-center gap-2 md:gap-3">

        {!connected ? (

          <button className={buttonClass} onClick={connectESP}>
            Connect ESP32
          </button>

        ) : (

          <button className={buttonClass} onClick={disconnectESP}>
            Disconnect
          </button>

        )}

        <input
          className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-teal-300 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-800 hover:file:bg-teal-200`}
          type="file"
          accept=".bin"
          onChange={(e) => {

            if (e.target.files?.length) {

              setFirmware(e.target.files[0]);
              setFirmwareName(e.target.files[0].name);

              addLog(
                `Firmware seleccionado: ${e.target.files[0].name}\n`
              );
            }
          }}
        />

        <button
          className={buttonClass}
          onClick={loadDefaultFirmware}
          disabled={!selectedFirmwareFile}
        >
          Load Selected Firmware
        </button>

        <select
          className={inputClass}
          value={selectedFirmwareFile}
          onChange={(e) => setSelectedFirmwareFile(e.target.value)}
          disabled={availableFirmwares.length === 0}
        >
          {availableFirmwares.length === 0 && (
            <option value="">No firmware found</option>
          )}
          {availableFirmwares.map((firmwareFile) => (
            <option key={firmwareFile} value={firmwareFile}>
              {firmwareFile}
            </option>
          ))}
        </select>

        <input
          className={inputClass}
          type="text"
          placeholder="Flash Address (e.g., 0x0000)"
          value={flashAddress}
          onChange={(e) => setFlashAddress(e.target.value)}
        />

        {firmwareName && (
          <div className="rounded-md border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-sm text-emerald-700">
            ✓ {firmwareName}
          </div>
        )}

        <button
          className={buttonClass}
          onClick={flashFirmware}
          disabled={!connected || !firmware || flashing}
        >
          {flashing ? "Flashing..." : "Flash Firmware"}
        </button>

        <button
          className={buttonClass}
          onClick={eraseFlash}
          disabled={!connected || flashing}
        >
          Erase Flash
        </button>

        <button
          className={buttonClass}
          onClick={() => sendCommand("test")}
          disabled={!connected}
        >
          Send TEST
        </button>

        </div>

        <div className="mb-2 h-4 w-full overflow-hidden rounded-full border border-slate-300 bg-slate-100">

          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-300 via-teal-300 to-emerald-300 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />

        </div>

        <div className="mb-4 text-sm text-slate-600">
          Progress: {progress}%
        </div>

      <div
        ref={logsContainerRef}
        className="h-[430px] overflow-y-auto rounded-xl border border-slate-300 bg-slate-50 p-3 font-mono text-sm text-slate-700 whitespace-pre-wrap"
      >
        {logs}
      </div>

      <div className="mt-5 flex items-center gap-2 text-sm text-slate-600">

        Status:

        <span className={connected ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
          {connected ? "CONNECTED" : "DISCONNECTED"}
        </span>

      </div>

      <footer className="mt-6 border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
        Programador interno
      </footer>

      </div>

    </div>
  );
}