import { Construction } from "lucide-react";

export function EmptyStubPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Construction className="mb-3 h-7 w-7 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        This page will be implemented by another team member.
      </p>
    </div>
  );
}
