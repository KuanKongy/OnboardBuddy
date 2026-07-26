import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Size discipline for the reader's anchor diagrams (audit E2 / §19.2, and
 * READER_REDESIGN.md N12): the same raw `MermaidDiagram` rendered a 37-table
 * ER at ~285px (unreadable, no recourse) and a 5-node cluster map across 1.4
 * viewports (no prose visible on the first screen). The reading flow gets a
 * height-clamped, scrollable preview; the full-size diagram lives one click
 * away in a near-fullscreen lightbox — content present, quiet until asked
 * (owner rule K1 applied to pictures).
 */
export function DiagramFrame({
  code,
  label,
  projectId,
}: {
  code: string;
  label: string;
  projectId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative">
      <div className="max-h-[22rem] overflow-auto rounded-lg">
        <MermaidDiagram code={code} label={label} projectId={projectId} />
      </div>
      <Button
        size="xs"
        variant="outline"
        className="absolute right-2 top-2 gap-1 bg-background/85 backdrop-blur"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge ${label}`}
      >
        <Maximize2 className="h-3 w-3" aria-hidden />
        Enlarge
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[min(96vw,80rem)] overflow-auto sm:max-w-[min(96vw,80rem)]">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold capitalize">{label}</DialogTitle>
          </DialogHeader>
          <MermaidDiagram code={code} label={label} projectId={projectId} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
