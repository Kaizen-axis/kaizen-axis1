import { useNavigate, useLocation } from 'react-router-dom';
import { NewClientForm } from '@/components/clients/NewClientForm';

export default function NewClient() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <NewClientForm
      prefill={location.state?.prefill}
      onSuccess={() => navigate('/clients')}
      onCancel={() => navigate(-1)}
    />
  );
}
