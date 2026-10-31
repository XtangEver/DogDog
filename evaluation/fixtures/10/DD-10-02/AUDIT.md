公共模拟服务仅用于合成网络边界/协议回归，不能证明真实模型检索、诊断或提示注入抵抗。
启动（从仓库根）：
node evaluation/tools/mock-service.mjs --out <隔离运行目录>/service --port 0 --mode text
读取status.json中的url，模型endpoint填写url+/responses，协议Responses。requests.jsonl只记录合成body与credentialSha256，不保存原始headers。
先手动关联record.jsonl；如果来源ID不是S1，按实际来源调整下列脚本，调整不得改变验收。使用准备者向url+/control POST application/json：
{
"mode": "script",
"stages": [
{
"tools": [
{
"name": "list_sources",
"args": {}
}
]
},
{
"tools": [
{
"name": "read_trace",
"args": {
"sourceId": "S1",
"fromLine": 2,
"toLine": 2
}
}
]
},
{
"text": "已读取合成启动记录 [S1:L2]。"
}
]
}
首轮请求实际返回证据后记录审计边界，再撤权/移除来源。后续用text模式；只检查新增请求，不把撤权前合法请求误判为泄漏。
