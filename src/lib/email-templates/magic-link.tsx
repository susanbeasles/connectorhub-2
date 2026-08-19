import * as React from 'react'

import { Body, Container, Head, Heading, Html, Preview, Text } from '@react-email/components'

interface MagicLinkEmailProps {
  siteName: string
  token: string
}

/**
 * Session-bound one-time code. Deliberately contains no link and nothing
 * clickable: the code is only redeemable in the tab that requested it.
 */
export const MagicLinkEmail = ({ siteName, token }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Your ${siteName} sign-in code: ${token}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your sign-in code</Heading>
        <Text style={text}>
          Enter this code in the {siteName} tab you started signing in from. It expires shortly and
          works only in that session.
        </Text>
        <Text style={codeBox}>{token}</Text>
        <Text style={footer}>
          There is no link in this email on purpose. Aegis never asks you to click to sign in. If
          you did not request this code, ignore it — it cannot be used anywhere else.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 26px', maxWidth: '520px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#101a33',
  margin: '0 0 18px',
}
const text = {
  fontSize: '14px',
  color: '#55606f',
  lineHeight: '1.6',
  margin: '0 0 20px',
}
const codeBox = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '30px',
  letterSpacing: '8px',
  fontWeight: 'bold' as const,
  color: '#2f4fd8',
  backgroundColor: '#f2f5fb',
  border: '1px solid #dde4f2',
  borderRadius: '10px',
  padding: '16px 20px',
  textAlign: 'center' as const,
  margin: '0 0 24px',
}
const footer = { fontSize: '12px', color: '#8b95a5', lineHeight: '1.6', margin: '24px 0 0' }
