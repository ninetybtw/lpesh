// Express 4 не ловит отклонённые промисы из async-обработчиков сам —
// без этой обёртки ошибка Prisma просто зависает запросом вместо ответа.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
