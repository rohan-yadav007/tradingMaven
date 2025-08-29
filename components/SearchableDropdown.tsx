import React, { useMemo } from 'react';
import Select, { StylesConfig, GroupBase, OnChangeValue } from 'react-select';

interface SearchableDropdownProps {
    options: string[];
    value: string | string[];
    onChange: (value: string | string[]) => void;
    disabled?: boolean;
    theme: 'light' | 'dark';
    isMulti?: boolean;
}

type SelectOptionType = {
    value: string;
    label: string;
};

const getCustomStyles = (isDark: boolean): StylesConfig<SelectOptionType, boolean, GroupBase<SelectOptionType>> => ({
    control: (provided, state) => ({
        ...provided,
        backgroundColor: isDark ? '#334155' : '#ffffff', // slate-700/50 -> slate-700, white
        borderColor: state.isFocused ? '#0ea5e9' : (isDark ? '#475569' : '#cbd5e1'), // sky-500, slate-600, slate-300
        boxShadow: state.isFocused ? '0 0 0 1px #0ea5e9' : 'none',
        '&:hover': {
            borderColor: state.isFocused ? '#0ea5e9' : (isDark ? '#64748b' : '#94a3b8') // sky-500, slate-500, slate-400
        },
        minHeight: '42px',
        borderRadius: '0.375rem',
        transition: 'border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
    }),
    valueContainer: (provided) => ({
        ...provided,
        padding: '0 8px'
    }),
    input: (provided) => ({
        ...provided,
        margin: '0px',
        color: isDark ? '#f1f5f9' : '#1e293b' // slate-100, slate-800
    }),
    indicatorSeparator: () => ({
        display: 'none',
    }),
    menu: (provided) => ({
        ...provided,
        backgroundColor: isDark ? '#1e293b' : '#ffffff', // slate-800, white
        border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`, // slate-700, slate-200
        zIndex: 1055,
        borderRadius: '0.375rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    }),
    option: (provided, state) => ({
        ...provided,
        backgroundColor: state.isSelected ? '#0ea5e9' : (state.isFocused ? (isDark ? '#334155' : '#f1f5f9') : 'transparent'), // sky-500, slate-700, slate-100
        color: state.isSelected ? '#ffffff' : (isDark ? '#f1f5f9' : '#1e293b'), // white, slate-100, slate-800
        '&:active': {
            backgroundColor: isDark ? '#475569' : '#e2e8f0' // slate-600, slate-200
        },
        cursor: 'pointer',
    }),
    singleValue: (provided) => ({
        ...provided,
        color: isDark ? '#f1f5f9' : '#1e293b', // slate-100, slate-800
        fontWeight: 500,
    }),
    multiValue: (provided) => ({
        ...provided,
        backgroundColor: isDark ? '#475569' : '#e2e8f0'
    }),
    multiValueLabel: (provided) => ({
        ...provided,
        color: isDark ? '#f1f5f9' : '#1e293b'
    }),
    placeholder: (provided) => ({
        ...provided,
        color: isDark ? '#94a3b8' : '#64748b' // slate-400, slate-500
    })
});


export const SearchableDropdown: React.FC<SearchableDropdownProps> = ({ options, value, onChange, disabled, theme, isMulti = false }) => {
    
    const selectOptions = useMemo(() => options.map(opt => ({ value: opt, label: opt })), [options]);

    const handleChange = (selectedOption: OnChangeValue<SelectOptionType, boolean>) => {
        if (isMulti) {
            const values = (selectedOption as SelectOptionType[]).map(o => o.value);
            onChange(values);
        } else {
            const value = (selectedOption as SelectOptionType)?.value || '';
            onChange(value);
        }
    };
    
    const customStyles = useMemo(() => getCustomStyles(theme === 'dark'), [theme]);

    const selectValue = useMemo(() => {
        if (isMulti) {
            return selectOptions.filter(o => (value as string[]).includes(o.value));
        }
        return selectOptions.find(o => o.value === value) || null;
    }, [value, selectOptions, isMulti]);

    return (
        <Select<SelectOptionType, boolean, GroupBase<SelectOptionType>>
            value={selectValue}
            onChange={handleChange}
            options={selectOptions}
            styles={customStyles}
            isDisabled={disabled}
            isMulti={isMulti}
            aria-label="Searchable dropdown for trading pairs"
        />
    );
};