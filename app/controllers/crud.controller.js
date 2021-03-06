"use strict";
//rest.controller.js
var debug = require('debug')('pushserver:crud.controller'),
EventEmitter = require('events').EventEmitter,
util = require('util'),
config = require('config').get('pushserver'),
_ = require('lodash');
/**
 * [CrudController description]
 * @param {[type]} model [description]
 */
var CrudController = function(model) {
  this.model = model;
  this.queryKey = [];
  this.queryDefaultSort = {
    _id: 1
  }; // used by getCollection
  // use full text search instead of strict equality on name
  this.querySearchOperatorOverride = {
    "name": "$regex"
  };
  // batchSize 
  this.configBatchSize = 100000;
  try {
    this.configBatchSize = config.get("dbConfig").get("batchSize");
  } catch (err) {}
};
// CrudController can emit events
util.inherits(CrudController, EventEmitter);
/**
 * [getCollectionAction description]
 * @param  {[type]}   query    [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
CrudController.prototype.getCollectionAction = function(query, callback) {
  var self = this;
  debug("query = ", query);
  var mongoQuery = self.buildQueryFromObject(query);
  // paginated results
  self.model.paginate(mongoQuery || {}, { page : query.page || 1, limit : query.limit || 0, sortBy: self.queryDefaultSort || {} }, function(err, objs,pageCount, itemCount) {
    self._getCollectionActionCallback(err, objs, pageCount, itemCount, callback);
  });
};
/**
 * [_getCollectionActionCallback description]
 * @param  {[type]}   err          [description]
 * @param  {[type]}   foundObjects [description]
 * @param  {[type]}   pageCount    [description]
 * @param  {[type]}   itemCount    [description]
 * @param  {Function} callback     [description]
 * @return {[type]}                [description]
 */
CrudController.prototype._getCollectionActionCallback = function(err, foundObjects, pageCount, itemCount, callback) {
  var self = this;
  if (err) {
    debug(err);
    debug("Did not find object with model : ", self.model.modelName);
    if (callback) {
      return callback(err);
    }
  } else if (callback) {
    // removing mongoose interval version number : no need for the user
    foundObjects.forEach(function(value, key) {
      foundObjects[key] = self.cleanObject(value);
    });
    callback(null, foundObjects, pageCount, itemCount);
  }
  self.emit('getCollectionAction', foundObjects);
};

/**
 * [getAction description]
 * @param  {[type]}   id       [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
CrudController.prototype.getAction = function(id, callback) {
  var self = this;
  self.model.findById(id, function(err, obj) {
    if (err || obj === null) {
      err = new Error("Object not found for ID :" + id);
      err.status = 404;
      debug("Did not find object ID : ", id, " with model : ", self.model.modelName);
      if (callback) {
        return callback(err);
      }
    } else if (callback) {
      // removing mongoose interval version number : no need for the user
      obj = self.cleanObject(obj);
      self.emit('getAction', obj);
      callback(null, obj);
    }
  });
};
/**
 * [postAction description]
 * @param  {[type]}   obj      [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
CrudController.prototype.postAction = function(obj, callback) {
  var self = this;
  try {
    obj = self.prepareObject(obj,true);
  } catch(error) {
    return callback(new Error(error));
  }
  self.model.create(obj, function(err, createdObject) {
    if (err) {
      console.error('Error while creating object :', obj);
      console.error(err);
      debug('Could not create object ', obj, ' : ', err.message);
      if (callback) {
        return callback(err);
      }
    } else if (callback) {
      // removing mongoose interval version number : no need for the user
      createdObject = self.cleanObject(createdObject);
      callback(null, createdObject);
      self.emit('postAction', createdObject);
    }
  });
};
/**
 * [putAction description]
 * @param  {[type]}   obj      [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
CrudController.prototype.putAction = function(obj, callback) {
  var self = this;
  try {
    var query = self.buildQueryFromObject(obj);
    obj = self.cleanObject(obj);
    try {
      obj = self.prepareObject(obj,true);
    } catch(error) {
      return callback(new Error(error));
    }
    debug('putAction : searching item to update with citeria : ', obj);
    self.model.findOneAndUpdate(query, obj || {}, {
      new: true,
      upsert: true,
      sort: {
        _id: -1
      }
    }, function(err, createdObject) {
      if (err) {
        console.error('Error while updating object %j with query %s\n', obj, query || 'id:' + obj.id);
        debug('Could not update object ', obj, ' : ', err.message);
        if (callback) {
          return callback(err);
        }
      } else if (callback) {
        createdObject = self.cleanObject(createdObject);
        callback(null, createdObject);
        self.emit('putAction', createdObject);
      }
    });
  } catch (err) {
    debug('Could not find object ', obj, ' : ', err.message);
    console.error("putAction error : ", err.message);
    err.message = "_id/id is not an valid object ID";
    if (callback) {
      return callback(err);
    }
  }
};
/**
 * [deleteAction description]
 * @param  {[type]}   id       [description]
 * @param  {[type]}   params   [description]
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
CrudController.prototype.deleteAction = function(id, params, callback) {
  var self = this, realId =null;
  
  try {
    realId = self.model.base.Types.ObjectId(id);
  } catch (err) {
    // id is not an object ID, let's try a query from parameters
    err.message = '_id/id is not an object ID.';
    if (callback) {
      callback(err);
    }
  }  
  
  self.model.findByIdAndRemove(realId, function(err, foundObject) {
    if (foundObject === null) {
      debug('Can not find object type ', self.model.modelName, ' for id :', realId);
      err = new Error('Object not found for deletion : ' + realId);
    }
    if (err) {
      if (callback) {
        return callback(err);
      }
    } else {
      debug('Object id :', foundObject, ' removed for object type: ', self.model.modelName);
      if (callback) {
        foundObject = self.cleanObject(foundObject);
        callback(null, foundObject);
        self.emit('deleteAction', foundObject);
      }
    }
  });

};
/**
 * [buildQueryFromObject description]
 * @param  {[type]} object [description]
 * @return {[type]}        [description]
 */
CrudController.prototype.buildQueryFromObject = function(object) {
  var self = this,
  query = null,
  obj = JSON.parse(JSON.stringify(object)),
  customQueryCriteria = null;
  debug("Building Query from object : %j", obj);

  // handling limit parameter
  if (obj.limit) {
   delete(obj.limit);
 }

  // handling page parameter
  if (obj.page) {
    delete(obj.page);
  }

  // handling skip parameter
  if (obj.skip) {
    delete(obj.skip);
  }

  // if a custom query criteria is set, save it for later use
  // then drop it from the object
  if (obj.customQueryCriteria) {
    customQueryCriteria = obj.customQueryCriteria;
    delete(obj.customQueryCriteria);
  }
  if (obj._id || obj.id) {
    var id = self.model.base.Types.ObjectId(obj._id || obj.id);
    debug("Querying usind Id %s", id);
    query = self.model.findById(id);
  } else {
    var customQuery = {};
    // if a specific key is set for the model, use it
    // only if all the elements of the key is provided
    var keyOfQuery = _.intersection(self.queryKey, _.keys(obj));
    if (self.queryKey.length && _.isEqual(keyOfQuery, self.queryKey)) {
      // retrieving the properties which belongs to the key
      keyOfQuery.forEach(function(value) {
        customQuery[value] = obj[value];
      });
      debug("Filtering search with queryKey :%j", customQuery);
    } else {
      // overriding the default operator, if set
      if (self.querySearchOperatorOverride) {
        var regExp = null;
        // init customQuery
        customQuery = obj;
        // retrieving the keys whose operator should be overriden
        _.intersection(_.keys(self.querySearchOperatorOverride), _.keys(obj)).forEach(function(value) {
          switch (self.querySearchOperatorOverride[value]) {
            case "$regex":
              // text search case insensitive for mongo 2.4
              regExp = new RegExp(obj[value]);
              customQuery[value] = {
                "$regex": regExp,
                "$options": "i"
              };
              break;
            }
          });
        debug("Overriding operator : %j", customQuery);
      } else {
        // otherwise, the whole object is used, untouched
        customQuery = obj;
      }
    }
    // creating the query object, and saving the criteria already set
    query = self.model.find(customQuery).toConstructor();
    // now re-instantiante the customize query Object. Adding new criteria won't reset those set by default
    query = new query();
  }

  // query object is now set
  // add the optionnal custom criteria to the query
  if (customQueryCriteria) {
    debug("Adding custom criteria : ", customQueryCriteria);
    query = query.find(customQueryCriteria);
  }
  // add the lean mongoose param : we don't need mongoose fuzzy stuff, just plain Javascript object
  // see https://groups.google.com/forum/#!topic/mongoose-orm/u2_DzDydcnA/discussion
  // using the batch size in order to improve big data set (devices mainly)
  debug("Querying using batchSize = " + self.configBatchSize);
  query = query.batchSize(self.configBatchSize).lean(true);
  return query;
};

/**
 * Clean the objet, changing the _id key to id and removing _v mongoose's internal version field
 * @param  {[object]} obj [object to clean]
 * @return {[object]}     [cleaned object]
 */
 CrudController.prototype.cleanObject = function(obj) {
  if (obj) {
    obj = JSON.parse(JSON.stringify(obj));
    delete(obj.__v);
    delete(obj.$inc);
    if (obj._id) {
      obj.id = obj._id;
      delete(obj._id);
    }
  }
  return obj;
};
/**
 * Prepare the object before insertion into database
 * @param {object} obj : object to prepare
 * @param {boolean} create : prepare object for creation if true
 * @returns {object}
 */
 CrudController.prototype.prepareObject = function(obj, create) {
  return obj;
};

module.exports = CrudController;