import { TopBar } from "@/components/TopBar";
import { LibraryPanel } from "@/components/LibraryPanel";
import { TreePanel } from "@/components/TreePanel";
import { InspectorPanel } from "@/components/InspectorPanel";
import { CodePanel } from "@/components/CodePanel";
import { PreviewPanel } from "@/components/PreviewPanel";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <aside className="w-[240px] shrink-0 border-r border-border bg-card overflow-y-auto">
          <LibraryPanel />
        </aside>

        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="h-[60%] min-h-0 border-b border-border">
            <PreviewPanel />
          </div>
          <div className="flex-1 min-h-0 bg-background overflow-y-auto">
            <TreePanel />
          </div>
        </main>

        <aside className="w-[380px] shrink-0 border-l border-border bg-card flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto border-b border-border">
            <InspectorPanel />
          </div>
          <div className="h-[45%] min-h-0 flex flex-col">
            <CodePanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
