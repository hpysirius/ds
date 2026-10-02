'use client';

import { useState } from 'react';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { http } from '@/lib/api';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const { data } = await http.post('/auth/login', values);
      localStorage.setItem('ds_token', data.accessToken);
      localStorage.setItem('ds_user', JSON.stringify(data.user));
      message.success('登录成功');
      // 回到登录前想访问的页面；没有则回首页。
      // 这里用整页跳转（而不是 router.replace），让 AppShell 重新挂载并向后端拉取最新的用户信息（含页面权限）。
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      const target = redirect && redirect.startsWith('/') ? redirect : '/';
      window.location.href = target;
    } catch (e: any) {
      message.error(e?.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)',
      }}
    >
      <Card style={{ width: 360, boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>电商选品分析系统</div>
          <Typography.Text type="secondary">请登录后继续使用</Typography.Text>
        </div>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ username: 'admin', password: 'admin123' }}
          onFinish={onFinish}
        >
          <Form.Item name="username" label="登录名" rules={[{ required: true, message: '请输入登录名' }]}>
            <Input prefix={<UserOutlined />} placeholder="请输入登录名" size="large" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" size="large" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
