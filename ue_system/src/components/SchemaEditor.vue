<template>
  <el-dialog :visible.sync="dialogVisible" :destroy-on-close="destroyOnClose" :close-on-click-modal="closeOnClickModal">
    <el-tabs v-model="activeTab" type="card" @tab-click="onTabClick">
      <el-tab-pane label="基本信息" name="first"></el-tab-pane>
      <el-tab-pane label="列定义" name="second"></el-tab-pane>
    </el-tabs>
    <el-form v-show="activeTab === 'first'" :model="schema" label-position="top">
      <el-form-item label="显示名（中文）">
        <el-input v-model="schema.title"></el-input>
      </el-form-item>
      <el-form-item label="说明">
        <el-input type="textarea" v-model="schema.description"></el-input>
      </el-form-item>
    </el-form>
    <tms-json-schema v-show="activeTab === 'second'" :schema="schema.body"></tms-json-schema>
    <div slot="footer" class="dialog-footer">
      <el-button type="primary" @click="onSubmit">提交</el-button>
      <el-button @click="dialogVisible = false">取消</el-button>
    </div>
  </el-dialog>
</template>
<script>
import { JsonSchema as TmsJsonSchema } from 'tms-vue-ui'
import apiSchema from '../apis/schema'

export default {
  name: 'SchemaEditor',
  components: { TmsJsonSchema },
  props: {
    dialogVisible: { default: true },
    bucketName: { type: String },
    schema: {
      type: Object,
      default: function() {
        return { title: '', description: '', scope: '', body: {} }
      }
    }
  },
  data() {
    return {
      activeTab: 'first',
      destroyOnClose: true,
      closeOnClickModal: false
    }
  },
  methods: {
    onTabClick() {},
    onSubmit() {
      if (this.schema._id) {
        apiSchema
          .update(this.bucketName, this.schema, this.schema)
          .then(newSchema =>
            this.$emit('submit', { ...newSchema, _id: this.schema._id })
          )
      } else {
        apiSchema
          .create(this.bucketName, this.schema)
          .then(newSchema => this.$emit('submit', newSchema))
      }
    },
    open(schema, bucketName) {
      this.bucketName = bucketName
      Object.assign(this.schema, schema)
      this.$mount()
      document.body.appendChild(this.$el)
      return new Promise(resolve => {
        this.$on('submit', schema => {
          this.dialogVisible = false
          resolve(schema)
        })
      })
    }
  }
}
</script>
