const enabled =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const wrap =
  (open: number) =>
  (text: string): string =>
    enabled ? `\x1b[${open}m${text}\x1b[39m` : text;

export const color = {
  thinking: wrap(90),
  tool: wrap(33),
  answer: wrap(32),
  status: wrap(36),
  task: wrap(34),
  queue: wrap(90),
  note: wrap(35),
  error: wrap(31),
  plan: wrap(95),
};
