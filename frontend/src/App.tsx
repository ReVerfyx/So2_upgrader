/** Маршрутизация приложения. */
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';
import { UpgradePage } from './pages/UpgradePage';
import { InventoryPage } from './pages/InventoryPage';
import { BalancePage } from './pages/BalancePage';
import { DepositPage } from './pages/DepositPage';
import { WithdrawPage } from './pages/WithdrawPage';
import { HistoryPage } from './pages/HistoryPage';
import { ProfilePage } from './pages/ProfilePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminUsers } from './pages/admin/AdminUsers';
import { AdminWithdrawals } from './pages/admin/AdminWithdrawals';
import { AdminDeposits } from './pages/admin/AdminDeposits';
import { AdminItems } from './pages/admin/AdminItems';
import { AdminUpgrades } from './pages/admin/AdminUpgrades';
import { AdminSettings } from './pages/admin/AdminSettings';
import { AdminLogs } from './pages/admin/AdminLogs';

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="upgrade" element={<UpgradePage />} />
        <Route path="login" element={<LoginPage />} />

        <Route
          path="inventory"
          element={
            <ProtectedRoute>
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="balance"
          element={
            <ProtectedRoute>
              <BalancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="deposit"
          element={
            <ProtectedRoute>
              <DepositPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="withdraw"
          element={
            <ProtectedRoute>
              <WithdrawPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="history"
          element={
            <ProtectedRoute>
              <HistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />

        {/* Админ-панель */}
        <Route
          path="admin"
          element={
            <ProtectedRoute adminOnly>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="withdrawals" element={<AdminWithdrawals />} />
          <Route path="deposits" element={<AdminDeposits />} />
          <Route path="items" element={<AdminItems />} />
          <Route path="upgrades" element={<AdminUpgrades />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="logs" element={<AdminLogs />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
