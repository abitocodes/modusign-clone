import { Spinner } from "@/components/tools/list-states";
import { ListPage, ListTitle } from "@/components/ui/list-page";

export default function Loading() {
  return (
    <ListPage>
      <ListTitle title="맞춤 입력란" />
      <div className="flex min-h-[180px] items-center justify-center">
        <Spinner />
      </div>
    </ListPage>
  );
}
