import { useState } from 'react';
import { Input } from '../../components/ui/input.js';
import { Disclosure } from '../../components/shared/Disclosure.js';
import { Button } from '../../components/ui/button.js';
import { Field, Code } from '../../components/shared/Controls.js';
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
  const [filters, setFilters] = useState({
    from: '',
    before: '',
    toolId: '',
    profileId: '',
    taskId: '',
    connectionId: '',
    deviceId: '',
    status: '',
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; token: string } | null>(null);
  const search = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();
  const calls = useQuery({
    queryKey: ['calls', search, cursor],
    queryFn: () =>
      api<{ items: Call[]; nextCursor: string | null }>(
        `/activity/calls?${search}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    refetchInterval: 5000,
  });
  const stats = useQuery({
    queryKey: ['call-stats', search],
    queryFn: () =>
      api<{ status: string; count: number; meanDurationMs: number | null }[]>(
        `/activity/calls/stats?${search}`,
      ),
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
      <div className="overview-grid">
        {(Object.keys(filters) as (keyof typeof filters)[]).map((key) => (
          <Field
            key={key}
            label={
              {
                from: '开始时间（ISO 8601，含时区）',
                before: '结束时间（不含，ISO 8601）',
                toolId: '工具 ID',
                profileId: 'Agent ID',
                taskId: '任务 ID',
                connectionId: '连接 ID',
                deviceId: '设备 ID',
                status: '状态',
              }[key]
            }
          >
            <Input
              value={filters[key]}
              onChange={(e) => {
                setFilters({ ...filters, [key]: e.target.value });
                setCursor(null);
                setPreview(null);
              }}
            />
          </Field>
        ))}
      </div>
      <Feedback error={stats.error} />
      <div className="overview-grid">
        {stats.data?.map((row) => (
          <Card className="p-4" key={row.status}>
            <Status value={row.status} />
            <strong>{row.count} 次</strong>
            <small>
              平均耗时 {row.meanDurationMs === null ? '—' : `${Math.round(row.meanDurationMs)} ms`}
            </small>
          </Card>
        ))}
      </div>
      <div className="my-4 flex flex-wrap items-center gap-3">
        <Action
          action={async () =>
            setPreview(
              await api('/activity/calls/cleanup/preview', {
                method: 'POST',
                body: JSON.stringify(Object.fromEntries(new URLSearchParams(search))),
              }),
            )
          }
        >
          预览清理当前范围
        </Action>
        {preview ? (
          <>
            <span>将清理 {preview.count} 条已结束记录，运行和等待回答的调用保留。</span>
            <Action
              danger
              action={async () => {
                await api('/activity/calls/cleanup', {
                  method: 'POST',
                  body: JSON.stringify({ token: preview.token }),
                });
                setPreview(null);
                setCursor(null);
              }}
            >
              执行清理
            </Action>
          </>
        ) : null}
      </div>
      <Card className="panel">
        <div className="panel-heading">
          <h2>调用记录 · 每页 50 条</h2>
          <span className="label">每 5 秒刷新</span>
        </div>
        {calls.data?.items.length ? (
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
              {calls.data.items.map((call) => (
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
                    <small>
                      Agent {call.profileId ?? '管理账号'} · 任务 {call.taskId ?? '无'}
                    </small>
                    <small>
                      {call.entry} · {call.phase} · 关联 {call.correlationId}
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
                    <Disclosure title="调用详情">
                      <Code value={call} />
                    </Disclosure>
                    {call.error ? (
                      <span className="text-destructive break-all">{call.error}</span>
                    ) : null}
                    {['running', 'waiting'].includes(call.status) ? (
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
      <div className="my-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={!cursor} onClick={() => setCursor(null)}>
          返回第一页
        </Button>
        <Button
          variant="outline"
          disabled={!calls.data?.nextCursor}
          onClick={() => setCursor(calls.data!.nextCursor)}
        >
          下一页
        </Button>
      </div>
    </>
  );
}
