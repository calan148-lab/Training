/**
 * The original app's sparkline, kept as-is: values scaled between their own min
 * and max so a narrow band (bodyweight over a month) still reads as a shape.
 */
export function Bars({ values, empty = 'Nothing logged yet.' }: { values: number[]; empty?: string }) {
  if (!values.length) return <p className="empty">{empty}</p>;
  const mx = Math.max(...values);
  const mn = Math.min(...values);
  const span = mx - mn || 1;
  return (
    <div className="bars">
      {values.slice(-14).map((v, i) => (
        <div key={i} style={{ height: `${12 + ((v - mn) / span) * 84}%` }} title={String(v)} />
      ))}
    </div>
  );
}
