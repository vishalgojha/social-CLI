export interface SlashCommandResult {
  consumed: boolean;
  inputToExecute?: string;
  systemMessage?: string;
}

export function handleSlashCommand(input: string): SlashCommandResult {
  const raw = String(input || "").trim();
  if (!raw.startsWith("/")) return { consumed: false };

  const cmd = raw.toLowerCase();
  if (cmd === "/help") {
    return {
      consumed: true,
      systemMessage: "Commands: /start, /setup, /next, /open <n>, /retry <n>, /help, /doctor, /status, /config, /logs, /replay latest, /ai <intent>. Memory: `my name is ...`."
    };
  }
  if (cmd === "/start" || cmd === "/setup" || cmd === "/onboard") return { consumed: true, inputToExecute: "guided setup" };
  if (cmd === "/next") return { consumed: true, inputToExecute: "__next__" };
  if (cmd.startsWith("/open ")) {
    const rest = raw.slice(6).trim();
    return { consumed: true, inputToExecute: `open ${rest}` };
  }
  if (cmd.startsWith("/retry ")) {
    const rest = raw.slice(7).trim();
    return { consumed: true, inputToExecute: `retry ${rest}` };
  }
  if (cmd === "/doctor") return { consumed: true, inputToExecute: "doctor" };
  if (cmd === "/status") return { consumed: true, inputToExecute: "status" };
  if (cmd === "/config") return { consumed: true, inputToExecute: "config" };
  if (cmd === "/logs") return { consumed: true, inputToExecute: "logs limit 20" };
  if (cmd === "/why") return { consumed: true, inputToExecute: "__why__" };
  if (cmd.startsWith("/replay")) {
    const rest = raw.replace(/^\/replay/i, "").trim();
    return { consumed: true, inputToExecute: `replay ${rest || "latest"}` };
  }
  if (cmd.startsWith("/ai ")) {
    const rest = raw.slice(4).trim();
    return { consumed: true, inputToExecute: `/ai ${rest}` };
  }

  return {
    consumed: true,
    systemMessage: `Unknown slash command: ${raw}. Try /help`
  };
}
