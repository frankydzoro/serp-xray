"use client";

interface Props {
  items: string[];
}

export default function Checklist({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <ol className="space-y-2 list-decimal list-inside">
      {items.map((item, i) => (
        <li key={i} className="text-sm p-2 rounded hover:bg-muted/20">
          {item}
        </li>
      ))}
    </ol>
  );
}