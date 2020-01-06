const log4js = require('log4js')
const logger = log4js.getLogger('mgdb-pool-plugins')
const Router = require('tms-koa/node_modules/koa-router')
const _ = require('lodash')

const fs = require('fs')
const { ResultFault, AccessTokenFault } = require('tms-koa/lib/response')
const Token = require('tms-koa/lib/auth/token')
const { RequestTransaction } = require('tms-koa/lib/model/transaction')

/**
 * 根据请求路径找到匹配的控制器和方法
 *
 * 最后1段作为方法
 * 倒数第2端为文件名（加.js）
 * 如果文件不存在，倒数第2段作为目录名，查找main.js文件
 *
 * @param {Request} ctx
 * @param {Client} client 客户端
 * @param {DbContext} dbContext 数据库实例
 * @param {MongoClient} mongoClient mongodb实例
 *
 */
function findCtrlAndMethod(ctx, client, dbContext, mongoClient, mongoose) {
  let { path } = ctx.request

  if (prefix) path = path.replace(prefix, '')

  let pieces = path.split('/')
  if (pieces.length < 2) {
    let logMsg = '参数错误，请求的对象不存在(1)'
    logger.isDebugEnabled()
      ? logger.debug(logMsg, pieces)
      : logger.error(logMsg)
    throw new Error(logMsg)
  }

  let method = pieces.splice(-1, 1)[0]
  let ctrlPath = process.cwd() + '/plugins/' + pieces.join('/') + '.js'
  if (!fs.existsSync(ctrlPath)) {
    ctrlPath = process.cwd() + '/plugins/' + pieces.join('/') + '/main.js'
    if (!fs.existsSync(ctrlPath)) {
      let logMsg = '参数错误，请求的对象不存在(2)'
      logger.isDebugEnabled()
        ? logger.debug(logMsg, ctrlPath)
        : logger.error(logMsg)
      throw new Error(logMsg)
    }
  }

  const CtrlClass = require(ctrlPath)
  const oCtrl = new CtrlClass(ctx, client, dbContext, mongoClient, mongoose)
  if (oCtrl[method] === undefined && typeof oCtrl[method] !== 'function') {
    let logMsg = '参数错误，请求的对象不存在(3)'
    logger.isDebugEnabled() ? logger.debug(logMsg, oCtrl) : logger.error(logMsg)
    throw new Error(logMsg)
  }

  return [oCtrl, method]
}
/**
 * 根据请求找到对应的控制器并执行
 *
 * @param {Context} ctx
 *
 */
async function fnCtrlWrapper(ctx, next) {
  let { request, response } = ctx
  let tmsClient
  if (Token.supported()) {
    const { access_token } = request.query
    if (!access_token) {
      response.body = new ResultFault('缺少access_token参数')
      return
    }

    let aResult = await Token.fetch(access_token)
    if (false === aResult[0]) {
      response.body = new AccessTokenFault(aResult[1])
      return
    }
    tmsClient = aResult[1]
  }
  // 数据库连接
  let dbContext, mongoClient, mongoose
  try {
    if (fs.existsSync(process.cwd() + '/config/db.js')) {
      let { DbContext } = require('tms-db')
      /**
       * 获取数据库连接
       */
      dbContext = new DbContext()
    }
    if (fs.existsSync(process.cwd() + '/config/mongodb.js')) {
      let MongoContext = require('tms-koa/lib/mongodb').Context
      mongoClient = await MongoContext.mongoClient()
    }
    if (fs.existsSync(process.cwd() + '/config/mongoose.js')) {
      let MongooseContext = require('tms-koa/lib/mongoose').Context
      mongoose = await MongooseContext.mongoose()
    }
    /**
     * 找到对应的控制器
     */
    let [oCtrl, method] = findCtrlAndMethod(
      ctx,
      tmsClient,
      dbContext,
      mongoClient,
      mongoose
    )
    /**
     * 是否需要事物？
     */
    if (dbContext) {
      let moTrans, trans
      if (appConfig.tmsTransaction === true) {
        if (
          oCtrl.tmsRequireTransaction &&
          typeof oCtrl.tmsRequireTransaction === 'function'
        ) {
          let transMethodes = oCtrl.tmsRequireTransaction()
          if (transMethodes && transMethodes[method]) {
            moTrans = new RequestTransaction(oCtrl, {
              db: dbContext.mysql,
              userid: tmsClient.id
            })
            trans = await moTrans.begin()
            //dbIns.transaction = trans
          }
        }
      }
    }
    /**
     * 前置操作
     */
    if (oCtrl.tmsBeforeEach && typeof oCtrl.tmsBeforeEach === 'function') {
      const resultBefore = await oCtrl.tmsBeforeEach(method)
      if (resultBefore instanceof ResultFault) {
        response.body = resultBefore
        return
      }
    }
    const result = await oCtrl[method](request)
    /**
     * 结束事物
     */
    //if (moTrans && trans) await moTrans.end(trans.id)

    response.body = result

    next()
  } catch (err) {
    logger.error('控制器执行异常', err)
    let errMsg = typeof err === 'string' ? err : err.toString()
    response.body = new ResultFault(errMsg)
  } finally {
    // 关闭数据库连接
    if (dbContext) {
      dbContext.end()
      dbContext = null
    }
  }
}

const appConfig = require(process.cwd() + '/config/app')
let prefix = _.get(appConfig, ['router', 'plugins', 'prefix'], '')
// 前缀必须以反斜杠开头
if (prefix && !/^\//.test(prefix)) prefix = `/${prefix}`

logger.info(`指定控制器前缀：${prefix}`)

const router = new Router({ prefix })
router.all('/*', fnCtrlWrapper)

module.exports = router