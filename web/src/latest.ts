/**
 * 最后一次请求获胜。快速连点时先发的请求可能后回,过期响应整条丢掉 ——
 * 成功、失败、收尾三条路径都要判,只判成功等于把错误和 loading 留给了旧请求。
 *
 * 用序号而不是 AbortController:需要的是「状态的最后写入者获胜」,序号对
 * 成功/失败/finally 三条路径统一生效;AbortController 只多省一点本地服务开销,
 * 却引入第二种失败模式(AbortError 落进 catch 画出假错误,还得再加一层过滤)。
 * 这里是有意不取消在途请求。
 */
export const createLatestGate = () => {
  let current = 0;
  return {
    begin: () => ++current,
    // ticket 0 从未由 begin() 发出过(begin 从 1 起算),不该被当成"当前"——
    // 否则一个忘了调 begin() 就直接判断的调用点会被默认放行。
    isCurrent: (ticket: number) => ticket !== 0 && ticket === current,
  };
};

export const createSelectionEpoch = () => {
  let current = 0;
  return {
    capture: () => current,
    advance: () => ++current,
    isCurrent: (epoch: number) => epoch === current,
  };
};
