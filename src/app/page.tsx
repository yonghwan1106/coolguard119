import bundle from "@/data/bundle.json";
import Console from "@/components/Console";
import type { DataBundle } from "@/lib/types";

export default function Page() {
  return <Console bundle={bundle as unknown as DataBundle} />;
}
