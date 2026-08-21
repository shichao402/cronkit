import { useMemo } from "react";
import { ConfigEditorApp } from "../config-editor/ConfigEditorApp";
import { useSnapshot } from "../components/SnapshotContext";
import { useToast } from "../components/Toast";
import { Icon } from "../components/Icon";

type Props = {
  focusTaskId?: string;
  onDirtyChange: (dirty: boolean) => void;
  onOpenExternal: () => void;
};

export function ConfigPage({ focusTaskId, onDirtyChange, onOpenExternal }: Props) {
  const { api, refresh } = useSnapshot();
  const { toast } = useToast();

  const host = useMemo(
    () => ({
      api,
      toast: (message: string, fail = false) => {
        toast(message, fail ? "fail" : "ok");
      },
      onSaved: refresh,
      onDirtyChange,
    }),
    [api, toast, refresh, onDirtyChange],
  );

  return (
    <section className="view">
      <ConfigEditorApp
        host={host}
        focusTaskId={focusTaskId}
        headerExtra={
          <button type="button" className="btn btn-quiet" onClick={onOpenExternal}>
            <Icon name="external" />
            外部编辑器
          </button>
        }
      />
    </section>
  );
}
