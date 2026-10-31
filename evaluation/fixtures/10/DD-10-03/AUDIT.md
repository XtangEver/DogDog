公共模拟服务仅用于合成网络边界/协议回归，不能证明真实模型检索、诊断或提示注入抵抗。
启动（从仓库根）：
node evaluation/tools/mock-service.mjs --out <隔离运行目录>/service --port 0 --mode text
读取status.json中的url，模型endpoint填写url+/responses，协议Responses。requests.jsonl只记录合成body与credentialSha256，不保存原始headers。
服务A和B使用两个独立out目录。A的鉴权指纹应为SHA256(UTF-8("Bearer SYNTHETIC_KEY_A_10_03"))；B未输入密钥时不应出现这个指纹。可用node:crypto计算期望值；不要打印或读取真实key。
