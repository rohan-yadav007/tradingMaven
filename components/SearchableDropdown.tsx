
import React, { useMemo } from 'react';
import Select, { StylesConfig, GroupBase, OnChangeValue } from 'react-select';

type SelectOptionType = {
    value: string;
    label: string;
};
type GroupedOptionType = {
    label: string;
    options: readonly SelectOptionType[];
};

interface SearchableDropdownProps {
    // FIX: Added SelectOptionType[] to the allowed types for options to resolve "value does not exist in type GroupedOptionType" errors
    options: readonly string[] | readonly SelectOptionType[] | readonly GroupedOptionType[];
    value: string | string[];
    onChange: (value: string | string[]) => void;
    disabled?: boolean;
    theme: 'light' | 'dark';
    isMulti?: boolean;
}

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
    
    const selectOptions = useMemo(() => {
        if (!options || options.length === 0) return [];
        
        const firstOpt = options[0];
        
        // FIX: Handling string options by mapping them to SelectOptionType
        if (typeof firstOpt === 'string') {
            return (options as string[]).map(opt => ({ value: opt, label: opt }));
        }
        
        // FIX: For non-string arrays, we assume it's already structured for react-select (SelectOptionType[] or GroupedOptionType[])
        return options;
    }, [options]);

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
        if (!options || options.length === 0) {
            return isMulti ? [] : null;
        }

        let allOptionsFlat: SelectOptionType[] = [];
        const firstOpt = options[0];

        if (typeof firstOpt === 'string') {
            allOptionsFlat = (options as string[]).map(opt => ({ value: opt, label: opt }));
        } else if (firstOpt && typeof firstOpt === 'object') {
            // FIX: Robust flattening logic for finding the current selection in the UI
            if ('options' in firstOpt) {
                (options as readonly GroupedOptionType[]).forEach(group => {
                    allOptionsFlat.push(...group.options);
                });
            } else {
                allOptionsFlat = options as unknown as SelectOptionType[];
            }
        }

        if (isMulti) {
            if (!Array.isArray(value)) return [];
            return allOptionsFlat.filter(o => value.includes(o.value));
        }
        if (typeof value !== 'string') return null;
        return allOptionsFlat.find(o => o.value === value) || null;
    }, [value, options, isMulti]);

    return (
        <Select<SelectOptionType, boolean, GroupBase<SelectOptionType>>
            value={selectValue}
            onChange={handleChange}
            options={selectOptions as any} // Cast to any to handle complex union types of options
            styles={customStyles}
            isDisabled={disabled}
            isMulti={isMulti}
            aria-label="Searchable dropdown"
        />
    );
};
