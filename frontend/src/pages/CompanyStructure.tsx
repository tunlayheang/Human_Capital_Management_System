import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCompanyStructure } from '../context/CompanyStructureContext';

/** Legacy route: opens the company structure popup and returns to the dashboard. */
export const CompanyStructure: React.FC = () => {
  const { openCompanyStructure } = useCompanyStructure();
  const navigate = useNavigate();

  useEffect(() => {
    openCompanyStructure();
    navigate('/dashboard', { replace: true });
  }, [openCompanyStructure, navigate]);

  return null;
};
