import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plug, Plus } from 'lucide-react';
import { Card } from '../../components/ui/card.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog.js';
import { api, type Connection, type Device } from '../../lib/api.js';
import { Action, Code, Empty, Feedback, Status } from '../../components/shared/Controls.js';
import { ConnectionForm } from './ConnectionForm.js';
import { ImportPanel } from './ImportPanel.js';

export default function ConnectionsPage() {
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<unknown>();
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: () => api<Connection[]>('/connections'),
  });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<Device[]>('/devices') });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECTIONS</span>
          <h1>MCP 连接</h1>
          <p>连接、授权和调用 MCP 工具无需配置模型；选择执行位置、连接方式和凭证归属。</p>
        </div>
        <Dialog open={show} onOpenChange={setShow}>
          <DialogTrigger render={<Button />}>
            <Plus size={17} />
            添加连接
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>新建 MCP 连接</DialogTitle>
              <DialogDescription>
                选择执行位置和连接协议，再填写服务地址或启动命令。
              </DialogDescription>
            </DialogHeader>
            <ConnectionForm
              devices={devices.data ?? []}
              onSaved={(created) => {
                setResult(created);
                setShow(false);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
      <Feedback error={connections.error ?? devices.error} />
      <Card className="panel">
        {connections.data?.length ? (
          connections.data.map((connection) => (
            <div className="connection-row" key={connection.id}>
              <div className="row">
                <div className="item-icon">
                  <Plug size={20} />
                </div>
                <div className="grow">
                  <strong>{connection.name}</strong>
                  <small>
                    {connection.adapter} · {connection.transport} · {connection.mode}{' '}
                    {connection.transport === 'stdio'
                      ? `· ${connection.adapter === 'device' ? '所选设备执行' : '平台主机执行'} `
                      : ''}
                    {connection.url ? `· ${connection.url}` : ''}
                    {connection.protocolVersion ? ` · MCP ${connection.protocolVersion}` : ''}
                  </small>
                </div>
                <Status value={connection.status} />
              </div>
              {connection.error ? <div className="error">{connection.error}</div> : null}
              <div className="row-actions">
                <Action
                  action={async () =>
                    setResult(
                      await api(`/connections/${connection.id}/discover`, { method: 'POST' }),
                    )
                  }
                >
                  连接 / 刷新目录
                </Action>
                <Action
                  action={() => api(`/connections/${connection.id}/stop`, { method: 'POST' })}
                >
                  停止连接
                </Action>
                {connection.transport !== 'stdio' ? (
                  <Action
                    action={async () =>
                      setResult(
                        await api(`/connections/${connection.id}/oauth/start`, { method: 'POST' }),
                      )
                    }
                  >
                    发起授权
                  </Action>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <Empty>还没有 MCP 连接，点击“添加连接”开始。</Empty>
        )}
      </Card>
      {result ? (
        <Card className="panel padded">
          <h2>操作结果</h2>
          <Code value={result} />
        </Card>
      ) : null}
      <ImportPanel devices={devices.data ?? []} />
    </>
  );
}
