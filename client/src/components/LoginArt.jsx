// Иллюстрации для страницы входа: плоские пейзажи на фоне цвета brand.
// Цвета подобраны под «лесную» палитру CRM (index.css → @theme).

const SUN = '#f6c96d';
const SUN_DEEP = '#ef9f5c';
const FAR = '#4a9670';
const MID = '#7cc39a';
const DARK = '#0e2f20';

const Bird = ({ x, y, s = 1 }) => (
  <path d={`M${x} ${y} q${5 * s} ${-5 * s} ${10 * s} 0 q${5 * s} ${-5 * s} ${10 * s} 0`} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" />
);

const Pine = ({ x, y, h = 44, c = DARK }) => (
  <g fill={c}>
    <rect x={x - 1.5} y={y - 6} width="3" height="8" rx="1" />
    <polygon points={`${x},${y - h} ${x - h * 0.22},${y - h * 0.55} ${x + h * 0.22},${y - h * 0.55}`} />
    <polygon points={`${x},${y - h * 0.75} ${x - h * 0.3},${y - h * 0.28} ${x + h * 0.3},${y - h * 0.28}`} />
    <polygon points={`${x},${y - h * 0.5} ${x - h * 0.38},${y - 4} ${x + h * 0.38},${y - 4}`} />
  </g>
);

const Cloud = ({ x, y, s = 1, o = 0.9 }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} opacity={o} fill="#fff"
    d="M0 20 a12 12 0 0 1 12-12 a16 16 0 0 1 30-2 a11 11 0 0 1 14 14 z" />
);

// Горы на рассвете — для вкладки «Вход»
export function MountainsArt({ className }) {
  return (
    <svg className={className} viewBox="0 0 320 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <circle cx="214" cy="104" r="58" fill="#fff" opacity=".08" />
      <circle cx="214" cy="104" r="44" fill="#fff" opacity=".1" />
      <circle cx="214" cy="104" r="32" fill={SUN} />
      <Cloud x={40} y={62} s={1.1} />
      <Cloud x={238} y={128} s={0.8} o={0.75} />
      <Bird x={92} y={112} /><Bird x={118} y={98} s={0.7} /><Bird x={262} y={60} s={0.8} />

      {/* дальний хребет со снежными шапками */}
      <polygon fill={FAR} points="0,236 52,168 88,204 148,118 196,184 236,148 320,224 320,300 0,300" />
      <polygon fill="#fff" points="148,118 134,138 142,134 149,142 156,133 163,139" />
      <polygon fill="#fff" opacity=".9" points="236,148 226,160 233,158 238,164 243,158 248,161" />
      <polygon fill="#fff" opacity=".9" points="52,168 43,180 50,178 55,184 59,178" />

      {/* средний план */}
      <path fill={MID} d="M0 262 L64 200 L108 238 L176 176 L250 244 L292 214 L320 232 V300 H0Z" />
      <path fill="#fff" opacity=".18" d="M176 176 L210 207 L192 204 L180 214 L172 200 Z" />

      {/* передний холм с ёлками */}
      <path fill={DARK} d="M0 276 Q90 248 170 270 T320 262 V300 H0Z" />
      <Pine x={34} y={274} h={48} /><Pine x={56} y={270} h={36} />
      <Pine x={262} y={266} h={50} /><Pine x={286} y={266} h={38} /><Pine x={240} y={270} h={30} />
      <path d="M150 300 Q160 282 176 276" stroke={SUN} strokeWidth="2" fill="none" opacity=".5" strokeDasharray="3 5" />
    </svg>
  );
}

// Закат над озером — для второй вкладки
export function SunsetArt({ className }) {
  return (
    <svg className={className} viewBox="0 0 320 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <circle cx="160" cy="196" r="96" fill={SUN} opacity=".12" />
      <circle cx="160" cy="196" r="74" fill={SUN} opacity=".18" />
      <circle cx="160" cy="196" r="54" fill={SUN} />
      <path d="M106 196 a54 54 0 0 1 108 0 z" fill={SUN_DEEP} opacity=".35" />
      {[168, 180, 190].map((y, i) => (
        <rect key={y} x="100" y={y} width="120" height={3 - i * 0.5} fill="#1e6a45" opacity=".35" />
      ))}
      <Cloud x={26} y={88} s={1} o={0.85} />
      <Cloud x={226} y={70} s={1.2} />
      <Bird x={118} y={70} s={0.9} /><Bird x={142} y={58} s={0.7} /><Bird x={196} y={112} s={0.6} />

      {/* горы по краям */}
      <path fill={FAR} d="M0 196 L0 132 L38 96 L72 140 L104 120 L150 196 Z" />
      <path fill="#fff" opacity=".85" d="M38 96 L28 108 L35 106 L40 112 L46 105 Z" />
      <path fill={FAR} d="M320 196 L320 120 L284 92 L244 150 L222 136 L178 196 Z" />
      <path fill="#fff" opacity=".85" d="M284 92 L274 104 L281 102 L287 108 L293 102 Z" />
      <path fill={DARK} opacity=".55" d="M0 196 L0 168 L34 150 L70 180 L96 196 Z M320 196 L320 162 L276 150 L236 196 Z" />

      {/* озеро и отражение */}
      <rect x="0" y="196" width="320" height="104" fill="#17573a" />
      {[[110, 208, 100], [124, 222, 72], [136, 236, 48], [146, 250, 28], [152, 264, 16]].map(([x, y, w]) => (
        <rect key={y} x={x} y={y} width={w} height="4" rx="2" fill={SUN} opacity=".75" />
      ))}
      {[[24, 216, 40], [250, 230, 46], [40, 252, 26], [228, 268, 30]].map(([x, y, w]) => (
        <rect key={y} x={x} y={y} width={w} height="2.5" rx="1.25" fill="#fff" opacity=".3" />
      ))}

      {/* берег с ёлками и камышом */}
      <path fill={DARK} d="M0 284 Q40 266 96 276 Q120 282 132 300 H0Z" />
      <path fill={DARK} d="M320 278 Q276 268 236 286 Q222 292 218 300 H320Z" />
      <Pine x={22} y={280} h={52} /><Pine x={46} y={276} h={38} />
      <Pine x={298} y={276} h={46} />
      {[[82, 278], [90, 280], [262, 280], [270, 278]].map(([x, y]) => (
        <g key={x} stroke={DARK} strokeWidth="2.5" strokeLinecap="round">
          <line x1={x} y1={y} x2={x - 3} y2={y - 22} />
          <rect x={x - 6} y={y - 30} width="5" height="12" rx="2.5" fill={DARK} stroke="none" />
        </g>
      ))}
    </svg>
  );
}
