公共模拟服务仅用于合成网络边界/协议回归，不能证明真实模型检索、诊断或提示注入抵抗。
启动（从仓库根）：
node evaluation/tools/mock-service.mjs --out <隔离运行目录>/service --port 0 --mode http401
读取status.json中的url，模型endpoint填写url+/responses，协议Responses。requests.jsonl只记录合成body与credentialSha256，不保存原始headers。
输入合成key MOCK-NEVER-REAL；远端401回显同值，界面/普通错误持久化应脱敏。准备者的合成请求审计与加密存储不计作用户可见泄漏。
