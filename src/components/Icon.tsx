type IconName =
  | 'play'
  | 'pause'
  | 'step'
  | 'reset'
  | 'move'
  | 'orbit'
  | 'inspect'
  | 'undo'
  | 'redo'
  | 'close'
  | 'plus'
  | 'duplicate'
  | 'delete'
  | 'download'
  | 'upload';
const paths: Record<IconName, React.ReactNode> = {
  play: <path d="m8 5 11 7-11 7Z" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  step: (
    <>
      <path d="m5 5 11 7-11 7ZM20 5v14" />
    </>
  ),
  reset: (
    <>
      <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />
    </>
  ),
  move: (
    <>
      <path d="M12 3v18M3 12h18m-12-6 3-3 3 3m3 3 3 3-3 3M9 18l3 3 3-3M6 9l-3 3 3 3" />
    </>
  ),
  orbit: (
    <>
      <ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  inspect: (
    <>
      <path d="M4 20V10m8 10V4m8 16v-7" />
    </>
  ),
  undo: (
    <>
      <path d="m8 5-5 5 5 5M3 10h10a7 7 0 0 1 7 7" />
    </>
  ),
  redo: (
    <>
      <path d="m16 5 5 5-5 5m5-5H11a7 7 0 0 0-7 7" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  delete: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
};
export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
