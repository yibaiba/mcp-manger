import { useQuery } from '@tanstack/react-query';
import { Card } from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { api, type Call, type Tool, type Connection } from '../../lib/api.js';
import { Action, date, Empty, Feedback, Status } from '../../components/shared/Controls.js';

export default function ActivityPage() {
  const calls = useQuery({
    queryKey: ['calls'],
    queryFn: () => api<Call[]>('/calls'),
    refetchInterval: 5000,
  });
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => api<Tool[]>('/tools') });
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: () => api<Connection[]>('/connections'),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACTIVITY</span>
          <h1>运行记录</h1>
          <p>记录执行位置与结果；“结果未知”需先检查设备，避免重复执行。</p>
        </div>
      </div>
      <Feedback error={calls.error ?? tools.error ?? connections.error} />
      <Card className="panel">
        <div className="panel-heading">
          <h2>最近 100 次调用</h2>
          <span className="label">每 5 秒刷新</span>
        </div>
        {calls.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableHead>工具 / 执行位置</TableHead>
                <TableHead>开始时间</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>诊断 / 操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.data.map((call) => (
                <TableRow key={call.id}>
                  <TableCell>
                    <Status value={call.status} />
                  </TableCell>
                  <TableCell>
                    <strong>
                      {tools.data?.find((tool) => tool.id === call.toolId)?.name ?? call.toolId}
                    </strong>
                    <small>
                      {connections.data?.find((connection) => connection.id === call.connectionId)
                        ?.name ?? call.connectionId}{' '}
                      · {call.adapter}
                    </small>
                    <small>{call.deviceId ?? '平台执行'}</small>
                  </TableCell>
                  <TableCell>{date(call.startedAt)}</TableCell>
                  <TableCell>
                    {call.endedAt
                      ? `${new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()} ms`
                      : '—'}
                  </TableCell>
                  <TableCell className="max-w-sm whitespace-normal">
                    {call.error ? (
                      <span className="text-destructive break-all">{call.error}</span>
                    ) : null}
                    {call.status === 'running' ? (
                      <Action action={() => api(`/calls/${call.id}/cancel`, { method: 'POST' })}>
                        请求取消
                      </Action>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty>尚无调用记录。</Empty>
        )}
      </Card>
    </>
  );
}
