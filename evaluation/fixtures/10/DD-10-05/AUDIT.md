公共模拟服务仅用于合成网络边界/协议回归，不能证明真实模型检索、诊断或提示注入抵抗。
启动（从仓库根）：
node evaluation/tools/mock-service.mjs --out <隔离运行目录>/service --port 0 --mode text
读取status.json中的url，模型endpoint填写url+/responses，协议Responses。requests.jsonl只记录合成body与credentialSha256，不保存原始headers。
准备者POST到url+/control：
{
"mode": "script",
"stages": [
{
"tools": [
{
"name": "discover_sessions",
"args": {
"query": "启动"
}
}
]
},
{
"tools": [
{
"name": "search_traces",
"args": {
"query": "启动"
}
}
]
},
{
"text": "受控边界检查结束；此固定文本没有语义评分资格。"
}
]
}
只检查工具边界与模型请求无外部标记；扫描反馈的语义需要真实模型单独试验。
