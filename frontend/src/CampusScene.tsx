import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";

const trees = Array.from({ length: 56 }, (_, index) => {
  const x = (index * 97 + 29) % 390;
  const y = (index * 173 + 41) % 844;
  return { x, y, size: 3 + (index % 4) };
}).filter(({ x, y }) => !(x > 255 && x < 370 && y > 455 && y < 670));

function Building({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <G>
      <Path
        d={`M${x + 5} ${y + 8}h${width}v${height}h-${width}z`}
        fill="#9C724E"
        opacity={0.45}
      />
      <Rect x={x} y={y} width={width} height={height} fill="#E7A361" />
      <Path d={`M${x} ${y}l10 -11h${width}l-10 11z`} fill="#FFD08B" />
      <Path d={`M${x + width} ${y}l10 -11v${height}l-10 11z`} fill="#C88654" />
      {Array.from({ length: Math.floor(width / 8) }, (_, index) => (
        <Rect
          key={index}
          x={x + 3 + index * 8}
          y={y + height - 6}
          width={4}
          height={2}
          fill="#B9784D"
        />
      ))}
    </G>
  );
}

function FootballField({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <G>
      <Rect
        x={x + 5}
        y={y + 6}
        width={width}
        height={height}
        fill="#937748"
        opacity={0.5}
      />
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#3E8B4B"
        stroke="#27693A"
        strokeWidth={4}
      />
      <Rect
        x={x + 5}
        y={y + 5}
        width={width - 10}
        height={height - 10}
        fill="none"
        stroke="#E8E6B5"
        strokeWidth={1.2}
      />
      <Path
        d={`M${x + width / 2} ${y + 5}v${height - 10}`}
        stroke="#E8E6B5"
        strokeWidth={1.2}
      />
      <Ellipse
        cx={x + width / 2}
        cy={y + height / 2}
        rx={7}
        ry={7}
        fill="none"
        stroke="#E8E6B5"
        strokeWidth={1.2}
      />
      <Rect
        x={x + 5}
        y={y + height / 3}
        width={8}
        height={height / 3}
        fill="none"
        stroke="#E8E6B5"
        strokeWidth={1}
      />
      <Rect
        x={x + width - 13}
        y={y + height / 3}
        width={8}
        height={height / 3}
        fill="none"
        stroke="#E8E6B5"
        strokeWidth={1}
      />
    </G>
  );
}

export default function CampusScene() {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 390 844"
      preserveAspectRatio="xMidYMid slice"
    >
      <Rect width={390} height={844} fill="#FFB976" />
      <Path
        d="M-20 64L410 136M-20 319L410 389M-20 708L410 751"
        stroke="#F6D09C"
        strokeWidth={27}
        opacity={0.65}
      />
      <Path
        d="M84 -20L-20 850M294 -20L169 850"
        stroke="#E7A868"
        strokeWidth={19}
        opacity={0.45}
      />
      <Building x={42} y={39} width={46} height={31} />
      <Building x={130} y={18} width={66} height={38} />
      <Building x={286} y={77} width={62} height={35} />
      <Building x={46} y={270} width={56} height={37} />
      <Building x={305} y={297} width={54} height={38} />
      <Building x={197} y={430} width={67} height={36} />
      <Building x={12} y={559} width={73} height={45} />
      <Building x={95} y={683} width={84} height={44} />
      <Building x={256} y={703} width={56} height={33} />
      <FootballField x={188} y={293} width={112} height={66} />
      <FootballField x={44} y={387} width={100} height={62} />
      <FootballField x={136} y={578} width={97} height={61} />
      <Circle cx={309} cy={547} r={78} fill="#276D38" opacity={0.35} />
      <Circle
        cx={306}
        cy={543}
        r={75}
        fill="#397F3F"
        stroke="#D6D17D"
        strokeWidth={3}
      />
      <Circle
        cx={306}
        cy={543}
        r={62}
        fill="none"
        stroke="#7AA15C"
        strokeWidth={11}
      />
      <Circle
        cx={306}
        cy={543}
        r={38}
        fill="none"
        stroke="#D6D17D"
        strokeWidth={1.5}
      />
      <Rect x={296} y={522} width={20} height={43} fill="#DAB977" />
      {trees.map(({ x, y, size }, index) => (
        <G key={index}>
          <Ellipse
            cx={x + 5}
            cy={y + 6}
            rx={size + 2}
            ry={size}
            fill="#9E794B"
            opacity={0.55}
          />
          <Circle
            cx={x}
            cy={y}
            r={size}
            fill={index % 3 ? "#386E32" : "#497C35"}
          />
          <Path
            d={`M${x} ${y - size}l${size / 2} ${size}l-${size} ${size / 3}z`}
            fill="#285A2C"
          />
        </G>
      ))}
      <Circle
        cx={103}
        cy={406}
        r={8}
        fill="#D2AD76"
        stroke="#865B35"
        strokeWidth={2}
      />
      <Circle
        cx={245}
        cy={319}
        r={8}
        fill="#D2AD76"
        stroke="#865B35"
        strokeWidth={2}
      />
      <Circle
        cx={307}
        cy={523}
        r={8}
        fill="#E72426"
        stroke="#A41618"
        strokeWidth={2}
      />
    </Svg>
  );
}
