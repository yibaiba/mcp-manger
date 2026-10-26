import { CheckChoice } from '../../components/shared/CheckChoice.js';
import type { ContentEntry } from '../../lib/api.js';

export function ContentGrants({
  entries,
  selected,
  connectionNames,
}: {
  entries: ContentEntry[];
  selected: string[];
  connectionNames: Map<string, string>;
}) {
  const granted = new Set(selected);
  return (
    <fieldset>
      <legend>允许访问的 Prompts 与 Resources</legend>
      {entries.map((entry) => (
        <CheckChoice
          key={entry.id}
          name="contentId"
          value={entry.id}
          defaultChecked={granted.has(entry.id)}
        >
          <span>
            <strong>{entry.name}</strong>
            <small>
              {entry.kind} · {connectionNames.get(entry.connectionId)}
            </small>
          </span>
        </CheckChoice>
      ))}
      {!entries.length ? (
        <small>连接 MCP 后会发现服务声明的提示词和资源。资源模板授权覆盖匹配该模板的 URI。</small>
      ) : null}
    </fieldset>
  );
}
