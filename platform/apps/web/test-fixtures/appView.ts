import { App } from '@modelcontextprotocol/ext-apps';
const app = new App({ name: 'Platform acceptance App', version: '1' }, {});
const status = document.querySelector('#status')!;
app.ontoolinput = (input) => {
  status.textContent = `参数已收到：${JSON.stringify(input.arguments)}`;
};
app.ontoolresult = (result) => {
  status.textContent = `结果已收到：${JSON.stringify(result.structuredContent)}`;
};
document.querySelector('#action')!.addEventListener('click', () => {
  void app.callServerTool({ name: 'app_action', arguments: {} }).then(
    (result) => {
      status.textContent = `App 工具调用成功：${JSON.stringify(result.structuredContent)}`;
    },
    (error) => {
      status.textContent = String(error);
    },
  );
});
void app.connect().catch((error) => {
  status.textContent = String(error);
});
