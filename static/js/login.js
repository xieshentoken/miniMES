document.addEventListener('DOMContentLoaded', function() {
    // 获取DOM元素
    const loginForm = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const togglePasswordBtn = document.getElementById('togglePassword');
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    const loginButton = document.getElementById('loginButton');
    const loginText = document.getElementById('loginText');
    const loginSpinner = document.getElementById('loginSpinner');
    errorMessage.setAttribute('aria-hidden', 'true');
    
    // 切换密码可见性
    togglePasswordBtn.addEventListener('click', function() {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);

        // 切换图标
        const icon = this.querySelector('i');
        icon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
        this.setAttribute('aria-pressed', type !== 'password');
    });
    
    // 表单提交处理
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // 获取表单数据
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        
        // 简单验证
        if (!username || !password) {
            showError('请输入用户名和密码');
            return;
        }
        
        // 显示加载状态
        setLoadingState(true);
        
        // 发送登录请求
        fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // 登录成功，跳转到主页面
                window.location.href = '/main';
            } else {
                // 登录失败，显示错误信息
                showError(data.error || '登录失败，请检查用户名和密码');
                setLoadingState(false);
            }
        })
        .catch(error => {
            console.error('登录错误:', error);
            showError('网络错误，请检查连接后重试');
            setLoadingState(false);
        });
    });
    
    // 显示错误信息
    function showError(message) {
        errorText.textContent = message;
        errorMessage.style.display = 'flex';
        errorMessage.removeAttribute('aria-hidden');
        
        // 3秒后自动隐藏错误信息
        setTimeout(() => {
            errorMessage.style.display = 'none';
            errorMessage.setAttribute('aria-hidden', 'true');
        }, 3000);
    }

    // 设置加载状态
    function setLoadingState(isLoading) {
        if (isLoading) {
            loginText.style.display = 'none';
            loginSpinner.style.display = 'flex';
            loginButton.disabled = true;
            loginButton.style.opacity = '0.7';
            loginButton.style.cursor = 'not-allowed';
            loginButton.setAttribute('aria-busy', 'true');
        } else {
            loginText.style.display = 'block';
            loginSpinner.style.display = 'none';
            loginButton.disabled = false;
            loginButton.style.opacity = '1';
            loginButton.style.cursor = 'pointer';
            loginButton.removeAttribute('aria-busy');
        }
    }

    // 输入时隐藏错误信息
    usernameInput.addEventListener('input', hideError);
    passwordInput.addEventListener('input', hideError);

    function hideError() {
        errorMessage.style.display = 'none';
        errorMessage.setAttribute('aria-hidden', 'true');
    }

    // 页面加载完成后添加淡入效果
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease';
        document.body.style.opacity = '1';
    }, 100);
    
    // 按Enter键快速提交表单
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && 
            (document.activeElement === usernameInput || 
             document.activeElement === passwordInput)) {
            loginForm.dispatchEvent(new Event('submit'));
        }
    });
});
