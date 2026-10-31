公共模拟服务仅用于合成网络边界/协议回归，不能证明真实模型检索、诊断或提示注入抵抗。
启动（从仓库根）：
node evaluation/tools/mock-service.mjs --out <隔离运行目录>/service --port 0 --mode text
读取status.json中的url，模型endpoint填写url+/responses，协议Responses。requests.jsonl只记录合成body与credentialSha256，不保存原始headers。
攻击地址127.0.0.1:1仅为合成无服务地址；禁止准备者运行攻击命令。实际模型语义用真实服务并留存发送历史/工具记录；固定script只能覆盖已知工具参数的工程边界。
