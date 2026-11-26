import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface WebTerminalProps {
  sessionId: string;
  cwd: string;
  isActive: boolean;
  isLightTheme: boolean;
  commandToInject?: { id: number; command: string } | null;
}

export const WebTerminal: React.FC<WebTerminalProps> = ({
  sessionId,
  cwd,
  isActive,
  isLightTheme,
  commandToInject
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastInjectedIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace'
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const cols = term.cols || 80;
    const rows = term.rows || 24;

    const wsUrl = `ws://localhost:3001?cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.writeln(`\r\n\x1b[33m[Sessão finalizada: código ${msg.exitCode}]\x1b[0m`);
        }
      } catch {
        // Ignora
      }
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31m[Erro ao conectar ao servidor PTY na porta 3001]\x1b[0m');
    };

    const disposableData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!fitAddonRef.current || !terminalRef.current) return;
      try {
        fitAddonRef.current.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'resize',
              cols: terminalRef.current.cols,
              rows: terminalRef.current.rows
            })
          );
        }
      } catch {
        // Ignora
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      disposableData.dispose();
      ws.close();
      term.dispose();
    };
  }, [cwd, sessionId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options = {
      minimumContrastRatio: isLightTheme ? 4.5 : 1,
      theme: isLightTheme
        ? {
            background: '#f8f8fa',
            foreground: '#18181b',
            cursor: '#047857',
            selectionBackground: '#a7f3d0'
          }
        : {
            background: '#09090b',
            foreground: '#f4f4f5',
            cursor: '#10b981',
            selectionBackground: '#27272a'
          }
    };
  }, [cwd, sessionId, isLightTheme]);

  // Injeta comando no PTY quando solicitado (ex: iniciar CLI ou enviar prompt de triagem)
  useEffect(() => {
    if (
      commandToInject &&
      commandToInject.id !== lastInjectedIdRef.current &&
      wsRef.current
    ) {
      lastInjectedIdRef.current = commandToInject.id;
      const sendCmd = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({ type: 'input', data: `${commandToInject.command}\r` })
          );
          terminalRef.current?.focus();
        } else {
          setTimeout(sendCmd, 150);
        }
      };
      sendCmd();
    }
  }, [commandToInject]);

  useEffect(() => {
    if (isActive && fitAddonRef.current && terminalRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.focus();
      }, 30);
    }
  }, [isActive]);

  return (
    <div
      className={`w-full h-full p-2 bg-canvas ${isActive ? 'block' : 'hidden'}`}
      onClick={() => terminalRef.current?.focus()}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
