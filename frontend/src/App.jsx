import React, { useContext } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import SignUp from './pages/SignUp'
import SignIn from './pages/SignIn'
import Customize from './pages/Customize'
import { userDataContext } from './context/UserContext'
import Home from './pages/Home'
import Customize2 from './pages/Customize2'

const FullScreenMessage = ({ title, subtitle }) => (
  <div className='w-full h-[100vh] bg-gradient-to-t from-[black] to-[#02023d] text-white flex items-center justify-center px-6'>
    <div className='max-w-[520px] text-center'>
      <h1 className='text-[28px] font-semibold mb-3'>{title}</h1>
      {subtitle && <p className='text-white/70 text-[16px]'>{subtitle}</p>}
    </div>
  </div>
)

function App() {
  const { userData, authLoading, authError } = useContext(userDataContext)

  if (authLoading) {
    return <FullScreenMessage title='Checking your session...' subtitle='Please wait while we load your account.' />
  }

  if (authError && !userData) {
    return <FullScreenMessage title='We could not verify your session.' subtitle={authError} />
  }

  const isAuthenticated = Boolean(userData)
  const hasAssistantProfile = Boolean(userData?.assistantImage && userData?.assistantName)

  return (
    <Routes>
      <Route
        path='/'
        element={
          !isAuthenticated
            ? <Navigate to='/signin' replace />
            : hasAssistantProfile
              ? <Home />
              : <Navigate to='/customize' replace />
        }
      />
      <Route path='/signup' element={!isAuthenticated ? <SignUp /> : <Navigate to='/' replace />} />
      <Route path='/signin' element={!isAuthenticated ? <SignIn /> : <Navigate to='/' replace />} />
      <Route path='/customize' element={isAuthenticated ? <Customize /> : <Navigate to='/signin' replace />} />
      <Route path='/customize2' element={isAuthenticated ? <Customize2 /> : <Navigate to='/signin' replace />} />
    </Routes>
  )
}

export default App
