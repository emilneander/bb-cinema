export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    heart: (
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    ),
    film: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m9 3-1 3-3 1-2 3 2 2-1 4 3 2 3-1 2 4 3-2 1-3 4-1 1-4-3-2-1-4-4 1Z" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8Z" />,
    pause: (
      <>
        <path d="M8 4v16M16 4v16" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L20 5" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    volume: (
      <>
        <path d="m3 9 4 0 5-5v16l-5-5H3Z" />
        <path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
      </>
    ),
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'play' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.film}
    </svg>
  );
}
