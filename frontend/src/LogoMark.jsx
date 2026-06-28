import { useId } from "react";

// Logo da plataforma: figura vermelha formada pela linha de batimento cardíaco,
// sobre pílula azul-marinho. Mesmo desenho usado na tela de login e no ícone do app.
export default function LogoMark({ size = 36, style }) {
  const uid = useId().replace(/:/g, "");
  const bg = `lmbg-${uid}`, rd = `lmr-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0, ...style }} role="img" aria-label="RH Survey">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1E1B4B" /><stop offset="1" stopColor="#312E81" />
        </linearGradient>
        <linearGradient id={rd} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#DC2626" /><stop offset="1" stopColor="#EF4444" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${bg})`} />
      <g transform="translate(6.2,12.1) scale(0.76)" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M26 18 L30 46 L34 33 L44 33 L63 33" stroke={`url(#${rd})`} strokeWidth="2.5" opacity="0.4" />
        <path d="M5 36 L14 36 L18 27 L22 46 L26 18" stroke={`url(#${rd})`} strokeWidth="2.5" />
        <line x1="26" y1="18" x2="26" y2="30" stroke="#EF4444" strokeWidth="2.5" />
        <path d="M20 23 L26 20 L32 23" stroke="#EF4444" strokeWidth="2.5" />
        <line x1="26" y1="30" x2="22" y2="40" stroke="#EF4444" strokeWidth="2.5" />
        <line x1="26" y1="30" x2="30" y2="40" stroke="#EF4444" strokeWidth="2.5" />
        <circle cx="26" cy="12" r="5.5" fill="#EF4444" />
      </g>
    </svg>
  );
}
