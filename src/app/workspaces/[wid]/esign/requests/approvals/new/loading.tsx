import { Spinner } from "@/components/tools/list-states";

export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-body">
      <Spinner />
    </div>
  );
}
